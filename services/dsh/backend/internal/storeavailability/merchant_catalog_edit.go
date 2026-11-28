package storeavailability

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var ErrCatalogDraftVersionConflict = errors.New("CATALOG_DRAFT_VERSION_CONFLICT")

type MerchantCatalogDraftEditChange struct {
	OperationID     string `json:"operationId"`
	ExpectedVersion int64  `json:"expectedVersion"`
	Name            string `json:"name"`
	PriceYER        string `json:"priceYer"`
	StockUnits      int64  `json:"stockUnits"`
}
type MerchantCatalogDraftEditResult struct {
	Offer  MerchantCatalogOffer `json:"offer"`
	Replay bool                 `json:"replay"`
}

func validateMerchantCatalogEdit(input MerchantCatalogDraftEditChange) (MerchantCatalogDraftEditChange, int64, error) {
	canonical, price, err := validateMerchantCatalogDraft(MerchantCatalogDraftChange{
		OperationID: input.OperationID, Name: input.Name, PriceYER: input.PriceYER, StockUnits: input.StockUnits,
	})
	if err != nil || input.ExpectedVersion < 1 || input.ExpectedVersion >= 9007199254740991 {
		return input, 0, ErrRegistrationInvalid
	}
	input.Name = canonical.Name
	return input, price, nil
}
func (s *MerchantStoreRegistrar) EditCatalogDraft(
	ctx context.Context, token, storeID, offerID string, change MerchantCatalogDraftEditChange,
) (MerchantCatalogDraftEditResult, error) {
	actor, err := s.actor(ctx, token)
	if err != nil {
		return MerchantCatalogDraftEditResult{}, err
	}
	if !registrationPublicID.MatchString(storeID) || !registrationPublicID.MatchString(offerID) || strings.HasPrefix(change.OperationID, "bulk-edit-v1-") {
		return MerchantCatalogDraftEditResult{}, ErrRegistrationInvalid
	}
	if _, _, err := validateMerchantCatalogEdit(change); err != nil {
		return MerchantCatalogDraftEditResult{}, err
	}
	tx, err := s.beginCatalogCommand(ctx, actor, storeID, "catalog_draft_edit_commands")
	if err != nil {
		return MerchantCatalogDraftEditResult{}, err
	}
	defer tx.Rollback()
	result, err := editCatalogDraftTx(ctx, tx, actor, storeID, offerID, change, false)
	if err != nil {
		return MerchantCatalogDraftEditResult{}, err
	}
	if err = s.commitCatalogCommand(ctx, tx, token, actor); err != nil {
		return MerchantCatalogDraftEditResult{}, err
	}
	return result, nil
}

func editCatalogDraftTx(ctx context.Context, tx *sql.Tx, actor, storeID, offerID string, change MerchantCatalogDraftEditChange, keepName bool) (MerchantCatalogDraftEditResult, error) {
	if !registrationPublicID.MatchString(offerID) {
		return MerchantCatalogDraftEditResult{}, ErrRegistrationInvalid
	}
	change, price, err := validateMerchantCatalogEdit(change)
	if err != nil {
		return MerchantCatalogDraftEditResult{}, err
	}
	payload, err := json.Marshal(struct {
		StoreID string                         `json:"storeId"`
		OfferID string                         `json:"offerId"`
		Edit    MerchantCatalogDraftEditChange `json:"edit"`
	}{StoreID: storeID, OfferID: offerID, Edit: change})
	if err != nil {
		return MerchantCatalogDraftEditResult{}, ErrRegistrationInvalid
	}
	sum := sha256.Sum256(payload)
	fingerprint := hex.EncodeToString(sum[:])
	var priorHash, priorStore, priorOffer, name string
	var priorExpected, priorResult, priorPrice, priorStock int64
	err = tx.QueryRowContext(ctx, `SELECT request_hash,store_id,offer_id,expected_version,result_version,
  result_name,result_price_yer,result_stock_units
  FROM catalog_draft_edit_commands WHERE actor_id=$1 AND operation_id=$2`,
		actor, change.OperationID).Scan(&priorHash, &priorStore, &priorOffer, &priorExpected, &priorResult,
		&name, &priorPrice, &priorStock)
	if err == nil {
		if priorHash != fingerprint || priorStore != storeID || priorOffer != offerID ||
			priorExpected != change.ExpectedVersion {
			return MerchantCatalogDraftEditResult{}, ErrOperationConflict
		}
		snapshot, readErr := catalogDraftSnapshot(ctx, tx, storeID, offerID)
		if readErr != nil {
			return MerchantCatalogDraftEditResult{}, readErr
		}
		snapshot.Name = name
		snapshot.PriceYER = fmtPriceYER(priorPrice)
		snapshot.StockUnits = priorStock
		snapshot.DraftVersion = priorResult
		snapshot.ProductActive = false
		snapshot.VariantSellable = false
		snapshot.RequiredAttributesValid = false
		snapshot.Published = false
		snapshot.Available = false
		return MerchantCatalogDraftEditResult{Offer: snapshot, Replay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MerchantCatalogDraftEditResult{}, ErrStoreOwnerUnavailable
	}

	// Only a DSH-created inactive draft may be updated. Identity and Store
	// ownership are rechecked inside the transaction that owns the SQL writes.
	var offer MerchantCatalogOffer
	var draftExists bool
	offer.StoreID = storeID
	err = tx.QueryRowContext(ctx, `SELECT o.id,p.id,p.name,v.id,o.price_yer::text,o.stock_units,o.draft_version,
  p.active,v.sellable,v.required_attributes_valid,o.published,o.available,
  EXISTS(SELECT 1 FROM catalog_draft_commands d WHERE d.store_id=o.store_id AND d.offer_id=o.id)
  FROM offers o JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
  JOIN variants v ON v.id=o.variant_id AND v.product_id=p.id
  WHERE o.store_id=$1 AND o.id=$2 FOR UPDATE OF o,p,v`, storeID, offerID).
		Scan(&offer.ID, &offer.ProductID, &offer.Name, &offer.VariantID, &offer.PriceYER,
			&offer.StockUnits, &offer.DraftVersion, &offer.ProductActive, &offer.VariantSellable,
			&offer.RequiredAttributesValid, &offer.Published, &offer.Available, &draftExists)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantCatalogDraftEditResult{}, ErrForbidden
	}
	if err != nil {
		return MerchantCatalogDraftEditResult{}, ErrStoreOwnerUnavailable
	}
	if !draftExists || offer.ProductActive || offer.VariantSellable || offer.RequiredAttributesValid ||
		offer.Published || offer.Available {
		return MerchantCatalogDraftEditResult{}, ErrForbidden
	}
	if keepName && offer.Name != change.Name {
		return MerchantCatalogDraftEditResult{}, ErrCatalogDraftVersionConflict
	}
	if offer.DraftVersion != change.ExpectedVersion {
		return MerchantCatalogDraftEditResult{}, ErrCatalogDraftVersionConflict
	}
	if !keepName {
		if _, err = tx.ExecContext(ctx, "UPDATE products SET name=$1 WHERE id=$2 AND store_id=$3",
			change.Name, offer.ProductID, storeID); err != nil {
			return MerchantCatalogDraftEditResult{}, ErrUnknownResult
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE offers SET price_yer=$1,stock_units=$2,draft_version=draft_version+1
  WHERE id=$3 AND store_id=$4 AND draft_version=$5 AND NOT published AND NOT available`,
		price, change.StockUnits, offerID, storeID, change.ExpectedVersion)
	if err != nil {
		return MerchantCatalogDraftEditResult{}, ErrUnknownResult
	}
	changed, e := result.RowsAffected()
	if e != nil || changed != 1 {
		return MerchantCatalogDraftEditResult{}, ErrUnknownResult
	}
	// Preserve the locked pre-edit snapshot and the new values atomically
	// with the same command used for version checks and replay.
	if _, err = tx.ExecContext(ctx, `INSERT INTO catalog_draft_edit_commands
  (actor_id,operation_id,request_hash,store_id,offer_id,expected_version,result_version,
  old_name,old_price_yer,old_stock_units,result_name,result_price_yer,result_stock_units)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		actor, change.OperationID, fingerprint, storeID, offerID, change.ExpectedVersion,
		change.ExpectedVersion+1, offer.Name, offer.PriceYER, offer.StockUnits,
		change.Name, price, change.StockUnits); err != nil {
		return MerchantCatalogDraftEditResult{}, ErrUnknownResult
	}
	offer.Name = change.Name
	offer.PriceYER = change.PriceYER
	offer.StockUnits = change.StockUnits
	offer.DraftVersion = change.ExpectedVersion + 1
	return MerchantCatalogDraftEditResult{Offer: offer, Replay: false}, nil
}
func fmtPriceYER(value int64) string { return strconv.FormatInt(value, 10) }

func NewMerchantCatalogEditHandler(service *MerchantStoreRegistrar) (http.Handler, error) {
	if service == nil || service.identity == nil || service.grants == nil || service.grants.db == nil {
		return nil, ErrStoreOwnerUnavailable
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", "PATCH")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !registrationPublicID.MatchString(r.PathValue("storeID")) ||
			!registrationPublicID.MatchString(r.PathValue("offerID")) ||
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
		var wire struct {
			OperationID     string `json:"operationId"`
			ExpectedVersion *int64 `json:"expectedVersion"`
			Name            string `json:"name"`
			PriceYER        string `json:"priceYer"`
			StockUnits      *int64 `json:"stockUnits"`
		}
		if decodeUniqueJSON(w, r, 8192, &wire) != nil || wire.ExpectedVersion == nil || wire.StockUnits == nil {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		change := MerchantCatalogDraftEditChange{OperationID: wire.OperationID, ExpectedVersion: *wire.ExpectedVersion, Name: wire.Name, PriceYER: wire.PriceYER, StockUnits: *wire.StockUnits}
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		result, err := service.EditCatalogDraft(ctx, token, r.PathValue("storeID"), r.PathValue("offerID"), change)
		if err != nil {
			if errors.Is(err, ErrCatalogDraftVersionConflict) {
				writeJSON(w, 409, struct {
					Code string `json:"code"`
				}{Code: "CATALOG_DRAFT_VERSION_CONFLICT"})
				return
			}
			writeRegistrationFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}), nil
}
