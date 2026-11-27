package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

// MerchantCatalogOffer is the private Store-scoped DSH projection of the
// existing Product, Variant and Offer records. It does not create another
// catalogue writer or imply that an unpublished item is purchasable.
type MerchantCatalogOffer struct {
	ID                      string `json:"id"`
	StoreID                 string `json:"storeId"`
	ProductID               string `json:"productId"`
	Name                    string `json:"name"`
	VariantID               string `json:"variantId"`
	PriceYER                string `json:"priceYer"`
	StockUnits              int64  `json:"stockUnits"`
	DraftVersion            int64  `json:"draftVersion"`
	ProductActive           bool   `json:"productActive"`
	VariantSellable         bool   `json:"variantSellable"`
	RequiredAttributesValid bool   `json:"requiredAttributesValid"`
	Published               bool   `json:"published"`
	Available               bool   `json:"available"`
}

type MerchantCatalogPage struct {
	ActorID    string                 `json:"actorId"`
	StoreID    string                 `json:"storeId"`
	Items      []MerchantCatalogOffer `json:"items"`
	NextCursor string                 `json:"nextCursor,omitempty"`
}

// Read-only private endpoint. A current Merchant bearer and a Store row owned
// by that actor are checked again in the same DSH transaction as the data.
// No delegated Store grants are accepted until they are implemented by DSH.
type merchantCatalogReadKind uint8

const (
	merchantCatalogPageRead merchantCatalogReadKind = iota
	merchantInventoryRead
	merchantDraftHistoryRead
)

func NewMerchantCatalogHandler(identity IdentitySessions, db *sql.DB, schema string) (http.Handler, error) {
	return newMerchantCatalogReadHandler(identity, db, schema, merchantCatalogPageRead)
}

func NewMerchantInventorySummaryHandler(identity IdentitySessions, db *sql.DB, schema string) (http.Handler, error) {
	return newMerchantCatalogReadHandler(identity, db, schema, merchantInventoryRead)
}

func NewMerchantCatalogDraftHistoryHandler(identity IdentitySessions, db *sql.DB, schema string) (http.Handler, error) {
	return newMerchantCatalogReadHandler(identity, db, schema, merchantDraftHistoryRead)
}

func newMerchantCatalogReadHandler(identity IdentitySessions, db *sql.DB, schema string, kind merchantCatalogReadKind) (http.Handler, error) {
	if identity == nil || db == nil || !postgresSchemaRule.MatchString(schema) {
		return nil, ErrStoreOwnerUnavailable
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeFailure(w, ErrUnauthorized)
			return
		}
		var limit int
		var before int64
		var cursor, query, status string
		var valid bool
		if kind == merchantDraftHistoryRead {
			limit, before, valid = policyHistoryParams(r.URL.RawQuery)
			valid = valid && !r.URL.ForceQuery && r.ContentLength == 0 && len(r.TransferEncoding) == 0 &&
				registrationPublicID.MatchString(r.PathValue("storeID")) && registrationPublicID.MatchString(r.PathValue("offerID")) &&
				before <= maxCatalogVersion
		} else {
			limit, cursor, query, status, valid = merchantCatalogPageParameters(r)
			valid = valid && (kind != merchantInventoryRead || r.URL.RawQuery == "")
		}
		if !valid {
			writeFailure(w, ErrInvalidChange)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		actor, err := identity.ResolveCurrentSession(ctx, token)
		if err != nil {
			if errors.Is(err, ErrIdentityUnavailable) {
				writeFailure(w, ErrIdentityUnavailable)
			} else {
				writeFailure(w, ErrUnauthorized)
			}
			return
		}
		if actor.Role != MerchantRole || actor.Subject == "" || strings.TrimSpace(actor.Subject) != actor.Subject {
			writeFailure(w, ErrForbidden)
			return
		}
		var result any
		switch kind {
		case merchantInventoryRead:
			result, err = readMerchantInventorySummary(ctx, db, schema, actor.Subject, r.PathValue("storeID"))
		case merchantDraftHistoryRead:
			result, err = readMerchantCatalogDraftHistory(ctx, db, schema, actor.Subject, r.PathValue("storeID"), r.PathValue("offerID"), limit, before)
		default:
			result, err = readMerchantCatalog(ctx, db, schema, actor.Subject, r.PathValue("storeID"), limit, cursor, query, status)
		}
		if err != nil {
			writeFailure(w, err)
			return
		}
		current, err := identity.ResolveCurrentSession(ctx, token)
		if err != nil || current != actor {
			if errors.Is(err, ErrIdentityUnavailable) {
				writeFailure(w, ErrIdentityUnavailable)
			} else {
				writeFailure(w, ErrUnauthorized)
			}
			return
		}
		writeJSON(w, http.StatusOK, result)
	}), nil
}

func merchantCatalogPageParameters(r *http.Request) (int, string, string, string, bool) {
	if !registrationPublicID.MatchString(r.PathValue("storeID")) ||
		r.URL.ForceQuery || r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		return 0, "", "", "", false
	}
	params, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(params) > 4 {
		return 0, "", "", "", false
	}
	limit := 20
	cursor, query, status := "", "", ""
	for key, values := range params {
		if len(values) != 1 || (key != "q" && values[0] == "") {
			return 0, "", "", "", false
		}
		switch key {
		case "limit":
			raw := values[0]
			if len(raw) > 2 || (len(raw) > 1 && raw[0] == '0') {
				return 0, "", "", "", false
			}
			for _, digit := range raw {
				if digit < '0' || digit > '9' {
					return 0, "", "", "", false
				}
			}
			n, e := strconv.Atoi(raw)
			if e != nil || n < 1 || n > 50 {
				return 0, "", "", "", false
			}
			limit = n
		case "cursor":
			if !registrationPublicID.MatchString(values[0]) {
				return 0, "", "", "", false
			}
			cursor = values[0]
		case "q":
			raw := values[0]
			if !utf8.ValidString(raw) || utf8.RuneCountInString(raw) > 80 || strings.ContainsRune(raw, 0) {
				return 0, "", "", "", false
			}
			query = strings.TrimSpace(raw)
		case "status":
			switch values[0] {
			case "published", "unpublished", "available", "unavailable", "stockout":
				status = values[0]
			default:
				return 0, "", "", "", false
			}
		default:
			return 0, "", "", "", false
		}
	}
	return limit, cursor, query, status, true
}

// Both private reads derive from one fixed owner projection. NOT MATERIALIZED
// permits PostgreSQL to push the page predicates into the Store-scoped join;
// the inventory branch is independent of page, cursor and search limits.
func readMerchantCatalogProjection(ctx context.Context, db *sql.DB, schema, actorID, storeID string, limit int, cursor, query, status string, inventory bool) ([]byte, error) {
	tx, err := dbscope.Begin(ctx, db, schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, "stores", "offers", "products", "variants")
	if err != nil {
		return nil, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	if err := requireMerchantCatalogStore(ctx, tx, actorID, storeID); err != nil {
		return nil, err
	}
	var projection []byte
	err = tx.QueryRowContext(ctx, `WITH catalog AS NOT MATERIALIZED (
		SELECT o.id, p.id AS product_id, p.name, v.id AS variant_id,
			o.price_yer::text AS price_yer, o.stock_units, o.draft_version,
			p.active AS product_active, v.sellable AS variant_sellable,
			v.required_attributes_valid, o.published, o.available,
			(o.published AND o.available AND p.active AND v.sellable
				AND v.required_attributes_valid AND o.price_yer>0 AND o.stock_units>0) AS eligible
		FROM offers o
		JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
		JOIN variants v ON v.id=o.variant_id AND v.product_id=p.id
		WHERE o.store_id=$1
	)
	SELECT CASE WHEN $6::boolean THEN (
		SELECT jsonb_build_object(
			'totalOffers', COUNT(*),
			'publishedOffers', COUNT(*) FILTER (WHERE published),
			'availableOffers', COUNT(*) FILTER (WHERE eligible),
			'unavailableOffers', COUNT(*) FILTER (WHERE published AND NOT eligible),
			'stockoutOffers', COUNT(*) FILTER (WHERE published AND stock_units=0)
		) FROM catalog
	) ELSE (
		SELECT COALESCE(jsonb_agg(jsonb_build_object(
			'id', id, 'productId', product_id, 'name', name, 'variantId', variant_id,
			'priceYer', price_yer, 'stockUnits', stock_units, 'draftVersion', draft_version,
			'productActive', product_active, 'variantSellable', variant_sellable,
			'requiredAttributesValid', required_attributes_valid,
			'published', published, 'available', available
		) ORDER BY id COLLATE "C"), '[]'::jsonb)
		FROM (
			SELECT * FROM catalog
			WHERE id COLLATE "C" > $2
			AND ($4 = '' OR strpos(lower(name), lower($4)) > 0)
			AND CASE $5
				WHEN '' THEN true
				WHEN 'published' THEN published
				WHEN 'unpublished' THEN NOT published
				WHEN 'available' THEN eligible
				WHEN 'unavailable' THEN published AND NOT eligible
				WHEN 'stockout' THEN published AND stock_units=0
				ELSE false
			END
			ORDER BY id COLLATE "C" LIMIT $3
		) AS page
	) END`, storeID, cursor, limit, query, status, inventory).Scan(&projection)
	if err != nil {
		return nil, ErrStoreOwnerUnavailable
	}
	if err := tx.Commit(); err != nil {
		return nil, ErrStoreOwnerUnavailable
	}
	return projection, nil
}

func readMerchantCatalog(ctx context.Context, db *sql.DB, schema, actorID, storeID string, limit int, cursor, query, status string) (MerchantCatalogPage, error) {
	projection, err := readMerchantCatalogProjection(ctx, db, schema, actorID, storeID, limit+1, cursor, query, status, false)
	if err != nil {
		return MerchantCatalogPage{}, err
	}
	result := MerchantCatalogPage{ActorID: actorID, StoreID: storeID, Items: []MerchantCatalogOffer{}}
	if err := json.Unmarshal(projection, &result.Items); err != nil || result.Items == nil {
		return MerchantCatalogPage{}, ErrStoreOwnerUnavailable
	}
	for i := range result.Items {
		result.Items[i].StoreID = storeID
	}
	if len(result.Items) > limit {
		result.Items = result.Items[:limit]
		result.NextCursor = result.Items[len(result.Items)-1].ID
	}
	return result, nil
}

type MerchantInventorySummary struct {
	ActorID           string `json:"actorId"`
	StoreID           string `json:"storeId"`
	TotalOffers       int64  `json:"totalOffers"`
	PublishedOffers   int64  `json:"publishedOffers"`
	AvailableOffers   int64  `json:"availableOffers"`
	UnavailableOffers int64  `json:"unavailableOffers"`
	StockoutOffers    int64  `json:"stockoutOffers"`
}

func requireMerchantCatalogStore(ctx context.Context, tx *sql.Tx, actorID, storeID string) error {
	var owner string
	if err := tx.QueryRowContext(ctx, "SELECT owner_actor_id FROM stores WHERE id=$1 FOR SHARE", storeID).Scan(&owner); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrForbidden
		}
		return ErrStoreOwnerUnavailable
	}
	if owner != actorID {
		return ErrForbidden
	}
	return nil
}

// Availability is Offer-level catalog eligibility, not Store orderability.
func readMerchantInventorySummary(ctx context.Context, db *sql.DB, schema, actorID, storeID string) (MerchantInventorySummary, error) {
	projection, err := readMerchantCatalogProjection(ctx, db, schema, actorID, storeID, 0, "", "", "", true)
	if err != nil {
		return MerchantInventorySummary{}, err
	}
	var result MerchantInventorySummary
	if err := json.Unmarshal(projection, &result); err != nil {
		return MerchantInventorySummary{}, ErrStoreOwnerUnavailable
	}
	result.ActorID, result.StoreID = actorID, storeID
	return result, nil
}
