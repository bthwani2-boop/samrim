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
		limit, cursor, valid := merchantCatalogPageParameters(r)
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
		page, err := readMerchantCatalog(ctx, db, schema, actor.Subject, r.PathValue("storeID"), limit, cursor)
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
		writeJSON(w, http.StatusOK, page)
	}), nil
}

func merchantCatalogPageParameters(r *http.Request) (int, string, bool) {
	if !registrationPublicID.MatchString(r.PathValue("storeID")) ||
		r.URL.ForceQuery || r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		return 0, "", false
	}
	params, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(params) > 2 {
		return 0, "", false
	}
	limit := 20
	cursor := ""
	for key, values := range params {
		if len(values) != 1 || values[0] == "" {
			return 0, "", false
		}
		switch key {
		case "limit":
			raw := values[0]
			if len(raw) > 2 || (len(raw) > 1 && raw[0] == '0') {
				return 0, "", false
			}
			for _, digit := range raw {
				if digit < '0' || digit > '9' {
					return 0, "", false
				}
			}
			n, e := strconv.Atoi(raw)
			if e != nil || n < 1 || n > 50 {
				return 0, "", false
			}
			limit = n
		case "cursor":
			if !registrationPublicID.MatchString(values[0]) {
				return 0, "", false
			}
			cursor = values[0]
		default:
			return 0, "", false
		}
	}
	return limit, cursor, true
}

func readMerchantCatalog(ctx context.Context, db *sql.DB, schema, actorID, storeID string, limit int, cursor string) (MerchantCatalogPage, error) {
	result := MerchantCatalogPage{ActorID: actorID, StoreID: storeID, Items: []MerchantCatalogOffer{}}
	tx, err := beginScopedStoreTx(ctx, db, schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	var owner string
	if err := tx.QueryRowContext(ctx, "SELECT owner_actor_id FROM stores WHERE id=$1 FOR SHARE", storeID).Scan(&owner); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return result, ErrForbidden
		}
		return result, ErrStoreOwnerUnavailable
	}
	if owner != actorID {
		return result, ErrForbidden
	}
	rows, err := tx.QueryContext(ctx, `SELECT o.id,p.id,p.name,v.id,o.price_yer::text,
		o.stock_units,p.active,v.sellable,v.required_attributes_valid,o.published,o.available
		FROM offers o
		JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
		JOIN variants v ON v.id=o.variant_id AND v.product_id=p.id
		WHERE o.store_id=$1 AND o.id COLLATE "C" > $2
		ORDER BY o.id COLLATE "C" LIMIT $3`, storeID, cursor, limit+1)
	if err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	for rows.Next() {
		var item MerchantCatalogOffer
		item.StoreID = storeID
		if err = rows.Scan(&item.ID, &item.ProductID, &item.Name, &item.VariantID,
			&item.PriceYER, &item.StockUnits, &item.ProductActive, &item.VariantSellable,
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
