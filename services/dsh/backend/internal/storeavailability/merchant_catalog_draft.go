package storeavailability

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

// Draft creation deliberately writes only DSH's existing Product, Variant and
// StoreOffer tables. It cannot publish, allocate stock or accept an Order.
type MerchantCatalogDraftChange struct {
	OperationID string `json:"operationId"`
	Name        string `json:"name"`
	PriceYER    string `json:"priceYer"`
	StockUnits  int64  `json:"stockUnits"`
}
type MerchantCatalogDraftResult struct {
	Offer  MerchantCatalogOffer `json:"offer"`
	Replay bool                 `json:"replay"`
}

func validateMerchantCatalogDraft(input MerchantCatalogDraftChange) (MerchantCatalogDraftChange, int64, error) {
	input.Name = strings.TrimSpace(input.Name)
	if !operationIDRule.MatchString(input.OperationID) ||
		!utf8.ValidString(input.Name) || len([]rune(input.Name)) < 1 || len([]rune(input.Name)) > 160 ||
		strings.ContainsFunc(input.Name, unicode.IsControl) ||
		len(input.PriceYER) < 1 || len(input.PriceYER) > 19 || (len(input.PriceYER) > 1 && input.PriceYER[0] == '0') ||
		input.StockUnits < 0 || input.StockUnits > math.MaxInt32 {
		return input, 0, ErrRegistrationInvalid
	}
	for _, digit := range input.PriceYER {
		if digit < '0' || digit > '9' {
			return input, 0, ErrRegistrationInvalid
		}
	}
	price, err := strconv.ParseInt(input.PriceYER, 10, 64)
	if err != nil || price < 1 {
		return input, 0, ErrRegistrationInvalid
	}
	return input, price, nil
}

func catalogDraftSnapshot(ctx context.Context, tx *sql.Tx, storeID, offerID string) (MerchantCatalogOffer, error) {
	var item MerchantCatalogOffer
	item.StoreID = storeID
	err := tx.QueryRowContext(ctx, `SELECT o.id,p.id,p.name,v.id,o.price_yer::text,
  o.stock_units,o.draft_version,p.active,v.sellable,v.required_attributes_valid,o.published,o.available
  FROM offers o JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
  JOIN variants v ON v.id=o.variant_id AND v.product_id=p.id
  WHERE o.store_id=$1 AND o.id=$2`, storeID, offerID).
		Scan(&item.ID, &item.ProductID, &item.Name, &item.VariantID, &item.PriceYER,
			&item.StockUnits, &item.DraftVersion, &item.ProductActive, &item.VariantSellable,
			&item.RequiredAttributesValid, &item.Published, &item.Available)
	if err != nil {
		return MerchantCatalogOffer{}, ErrStoreOwnerUnavailable
	}
	return item, nil
}

// Keep the original actor bound to every confirmation, including replays.
func (s *MerchantStoreRegistrar) confirmCatalogActor(ctx context.Context, token, expectedActor string) error {
	current, err := s.actor(ctx, token)
	if err != nil || current != expectedActor {
		return ErrUnknownResult
	}
	return nil
}

// All draft commands share one relation-bound transaction and actor lock.
// Extra relations are explicit requirements of the individual command.
func (s *MerchantStoreRegistrar) beginCatalogCommand(ctx context.Context, actor, storeID string, extraRelations ...string) (*sql.Tx, error) {
	relations := append([]string{"stores", "offers", "products", "variants", "catalog_draft_commands"}, extraRelations...)
	tx, err := dbscope.Begin(ctx, s.grants.db, s.grants.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, relations...)
	if err != nil {
		return nil, ErrStoreOwnerUnavailable
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(84932,hashtext($1))", actor); err != nil {
		_ = tx.Rollback()
		return nil, ErrStoreOwnerUnavailable
	}
	if err = requireMerchantCatalogStore(ctx, tx, actor, storeID); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

// Never report success until the original actor is confirmed on both sides
// of commit. A failed commit or lost confirmation has an unknown outcome.
func (s *MerchantStoreRegistrar) commitCatalogCommand(ctx context.Context, tx *sql.Tx, token, actor string) error {
	if err := s.confirmCatalogActor(ctx, token, actor); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return ErrUnknownResult
	}
	return s.confirmCatalogActor(ctx, token, actor)
}

func (s *MerchantStoreRegistrar) CreateCatalogDraft(
	ctx context.Context, token, storeID string, input MerchantCatalogDraftChange,
) (MerchantCatalogDraftResult, error) {
	actorID, err := s.actor(ctx, token)
	if err != nil {
		return MerchantCatalogDraftResult{}, err
	}
	if !registrationPublicID.MatchString(storeID) {
		return MerchantCatalogDraftResult{}, ErrRegistrationInvalid
	}
	input, price, err := validateMerchantCatalogDraft(input)
	if err != nil {
		return MerchantCatalogDraftResult{}, err
	}
	payload, err := json.Marshal(struct {
		StoreID string                     `json:"storeId"`
		Input   MerchantCatalogDraftChange `json:"input"`
	}{StoreID: storeID, Input: input})
	if err != nil {
		return MerchantCatalogDraftResult{}, ErrRegistrationInvalid
	}
	hash := sha256.Sum256(payload)
	fingerprint := hex.EncodeToString(hash[:])
	tx, err := s.beginCatalogCommand(ctx, actorID, storeID)
	if err != nil {
		return MerchantCatalogDraftResult{}, err
	}
	defer tx.Rollback()
	result, err := createCatalogDraftTx(ctx, tx, actorID, storeID, input, price, fingerprint)
	if err != nil {
		return MerchantCatalogDraftResult{}, err
	}
	if err = s.commitCatalogCommand(ctx, tx, token, actorID); err != nil {
		return MerchantCatalogDraftResult{}, err
	}
	return result, nil
}

func createCatalogDraftTx(ctx context.Context, tx *sql.Tx, actorID, storeID string, input MerchantCatalogDraftChange, price int64, fingerprint string) (MerchantCatalogDraftResult, error) {
	var oldHash, oldStore, offerID string
	err := tx.QueryRowContext(ctx, `SELECT request_hash,store_id,offer_id FROM catalog_draft_commands
  WHERE actor_id=$1 AND operation_id=$2`, actorID, input.OperationID).Scan(&oldHash, &oldStore, &offerID)
	if err == nil {
		if oldHash != fingerprint || oldStore != storeID {
			return MerchantCatalogDraftResult{}, ErrOperationConflict
		}
		offer, readErr := catalogDraftSnapshot(ctx, tx, storeID, offerID)
		if readErr != nil {
			return MerchantCatalogDraftResult{}, readErr
		}
		// Replays return the ORIGINAL committed result, even after a later
		// authorized draft edit, not an unrelated current Product snapshot.
		offer.Name = input.Name
		offer.PriceYER = input.PriceYER
		offer.StockUnits = input.StockUnits
		offer.DraftVersion = 1
		offer.ProductActive, offer.VariantSellable, offer.RequiredAttributesValid = false, false, false
		offer.Published, offer.Available = false, false
		return MerchantCatalogDraftResult{Offer: offer, Replay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MerchantCatalogDraftResult{}, ErrStoreOwnerUnavailable
	}
	var random [16]byte
	if _, err = rand.Read(random[:]); err != nil {
		return MerchantCatalogDraftResult{}, ErrStoreOwnerUnavailable
	}
	id := hex.EncodeToString(random[:])
	productID, variantID := "p-"+id, "v-"+id
	offerID = "of-" + id
	if _, err = tx.ExecContext(ctx, `INSERT INTO products(id,store_id,name,active) VALUES ($1,$2,$3,false)`,
		productID, storeID, input.Name); err != nil {
		return MerchantCatalogDraftResult{}, ErrUnknownResult
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO variants(id,product_id,sellable,required_attributes_valid) VALUES ($1,$2,false,false)`,
		variantID, productID); err != nil {
		return MerchantCatalogDraftResult{}, ErrUnknownResult
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO offers(id,store_id,product_id,variant_id,published,available,price_yer,stock_units)
  VALUES ($1,$2,$3,$4,false,false,$5,$6)`,
		offerID, storeID, productID, variantID, price, input.StockUnits); err != nil {
		return MerchantCatalogDraftResult{}, ErrUnknownResult
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO catalog_draft_commands
  (actor_id,operation_id,request_hash,store_id,offer_id) VALUES ($1,$2,$3,$4,$5)`,
		actorID, input.OperationID, fingerprint, storeID, offerID); err != nil {
		return MerchantCatalogDraftResult{}, ErrUnknownResult
	}
	return MerchantCatalogDraftResult{Offer: MerchantCatalogOffer{
		ID: offerID, StoreID: storeID, ProductID: productID, Name: input.Name,
		VariantID: variantID, PriceYER: input.PriceYER, StockUnits: input.StockUnits, DraftVersion: 1,
		ProductActive: false, VariantSellable: false, RequiredAttributesValid: false,
		Published: false, Available: false,
	}, Replay: false}, nil
}

func NewMerchantCatalogDraftHandler(registrar *MerchantStoreRegistrar) (http.Handler, error) {
	if registrar == nil || registrar.identity == nil || registrar.grants == nil || registrar.grants.db == nil {
		return nil, ErrStoreOwnerUnavailable
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !registrationPublicID.MatchString(r.PathValue("storeID")) ||
			r.URL.RawQuery != "" || r.URL.ForceQuery ||
			r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeRegistrationFailure(w, ErrUnauthorized)
			return
		}
		var command MerchantCatalogDraftChange
		if decodeUniqueJSON(w, r, 8192, &command) != nil {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		result, err := registrar.CreateCatalogDraft(ctx, token, r.PathValue("storeID"), command)
		if err != nil {
			writeRegistrationFailure(w, err)
			return
		}
		status := http.StatusCreated
		if result.Replay {
			status = http.StatusOK
		}
		writeJSON(w, status, result)
	}), nil
}
