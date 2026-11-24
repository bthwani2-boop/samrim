package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
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
func NewMerchantCatalogHandler(identity IdentitySessions, db *sql.DB, schema string) (http.Handler, error) {
	return newMerchantCatalogReadHandler(identity, db, schema, false)
}

func NewMerchantInventorySummaryHandler(identity IdentitySessions, db *sql.DB, schema string) (http.Handler, error) {
	return newMerchantCatalogReadHandler(identity, db, schema, true)
}

func newMerchantCatalogReadHandler(identity IdentitySessions, db *sql.DB, schema string, inventory bool) (http.Handler, error) {
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
		limit, cursor, query, status, valid := merchantCatalogPageParameters(r)
		if !valid || (inventory && r.URL.RawQuery != "") {
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
		if inventory {
			result, err = readMerchantInventorySummary(ctx, db, schema, actor.Subject, r.PathValue("storeID"))
		} else {
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

// The catalog summary and status filter share the same offer-level predicate.
const catalogAvailableSQL = `o.published AND o.available AND p.active AND v.sellable
	AND v.required_attributes_valid AND o.price_yer>0 AND o.stock_units>0`

func readMerchantCatalog(ctx context.Context, db *sql.DB, schema, actorID, storeID string, limit int, cursor, query, status string) (MerchantCatalogPage, error) {
	result := MerchantCatalogPage{ActorID: actorID, StoreID: storeID, Items: []MerchantCatalogOffer{}}
	tx, err := beginScopedStoreTx(ctx, db, schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	if err := requireMerchantCatalogStore(ctx, tx, actorID, storeID); err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT o.id,p.id,p.name,v.id,o.price_yer::text,
		o.stock_units,o.draft_version,p.active,v.sellable,v.required_attributes_valid,o.published,o.available
		FROM offers o
		JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
		JOIN variants v ON v.id=o.variant_id AND v.product_id=p.id
		WHERE o.store_id=$1 AND o.id COLLATE "C" > $2
		AND ($4 = '' OR strpos(lower(p.name), lower($4)) > 0)
		AND CASE $5
			WHEN '' THEN true
			WHEN 'published' THEN o.published
			WHEN 'unpublished' THEN NOT o.published
			WHEN 'available' THEN (`+catalogAvailableSQL+`)
			WHEN 'unavailable' THEN o.published AND NOT (`+catalogAvailableSQL+`)
			WHEN 'stockout' THEN o.published AND o.stock_units=0
			ELSE false
		END
		ORDER BY o.id COLLATE "C" LIMIT $3`, storeID, cursor, limit+1, query, status)
	if err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	for rows.Next() {
		var item MerchantCatalogOffer
		item.StoreID = storeID
		if err = rows.Scan(&item.ID, &item.ProductID, &item.Name, &item.VariantID,
			&item.PriceYER, &item.StockUnits, &item.DraftVersion, &item.ProductActive, &item.VariantSellable,
			&item.RequiredAttributesValid, &item.Published, &item.Available); err != nil {
			break
		}
		result.Items = append(result.Items, item)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return MerchantCatalogPage{}, ErrStoreOwnerUnavailable
	}
	if len(result.Items) > limit {
		result.Items = result.Items[:limit]
		result.NextCursor = result.Items[len(result.Items)-1].ID
	}
	if err = tx.Commit(); err != nil {
		return MerchantCatalogPage{}, ErrStoreOwnerUnavailable
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

// One owner-scoped SQL snapshot, independent of page/search limits.
// Availability is Offer-level catalog eligibility, not Store orderability.
func readMerchantInventorySummary(ctx context.Context, db *sql.DB, schema, actorID, storeID string) (MerchantInventorySummary, error) {
	result := MerchantInventorySummary{ActorID: actorID, StoreID: storeID}
	tx, err := beginScopedStoreTx(ctx, db, schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return MerchantInventorySummary{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	if err := requireMerchantCatalogStore(ctx, tx, actorID, storeID); err != nil {
		return MerchantInventorySummary{}, err
	}
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*),
		COUNT(*) FILTER (WHERE o.published),
		COUNT(*) FILTER (WHERE `+catalogAvailableSQL+`),
		COUNT(*) FILTER (WHERE o.published AND o.stock_units=0)
		FROM offers o
		JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
		JOIN variants v ON v.id=o.variant_id AND v.product_id=p.id
		WHERE o.store_id=$1`, storeID).Scan(&result.TotalOffers, &result.PublishedOffers,
		&result.AvailableOffers, &result.StockoutOffers)
	if err != nil {
		return MerchantInventorySummary{}, ErrStoreOwnerUnavailable
	}
	result.UnavailableOffers = result.PublishedOffers - result.AvailableOffers
	if err := tx.Commit(); err != nil {
		return MerchantInventorySummary{}, ErrStoreOwnerUnavailable
	}
	return result, nil
}
