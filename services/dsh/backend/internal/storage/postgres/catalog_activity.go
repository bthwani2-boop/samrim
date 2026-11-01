package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrCatalogActivityFilter = errors.New("catalog activity filter or cursor is invalid")

type CatalogActivityFilter struct {
	StoreID string
	Query   string
	Kind    string
	Action  string
	From    string
	To      string
	Cursor  string
	Limit   int
}

type CatalogActivityItem struct {
	ID                 string    `json:"id"`
	Kind               string    `json:"kind"`
	Action             string    `json:"action"`
	ActorID            string    `json:"actorId"`
	Subject            string    `json:"subject"`
	EntityID           string    `json:"entityId"`
	StoreID            string    `json:"storeId"`
	At                 time.Time `json:"at"`
	Version            int       `json:"version"`
	FromState          string    `json:"fromState,omitempty"`
	ToState            string    `json:"toState,omitempty"`
	PriceMinor         *int64    `json:"priceMinor,omitempty"`
	PreviousPriceMinor *int64    `json:"previousPriceMinor,omitempty"`
}

type CatalogActivityPage struct {
	Items      []CatalogActivityItem `json:"items"`
	NextCursor string                `json:"nextCursor"`
}

type catalogActivityCursor struct {
	V          int    `json:"v"`
	At         string `json:"at"`
	Kind       string `json:"kind"`
	ID         int64  `json:"id"`
	StoreID    string `json:"storeId"`
	Query      string `json:"query"`
	FilterKind string `json:"filterKind"`
	Action     string `json:"action"`
	From       string `json:"from"`
	To         string `json:"to"`
}

func parseCatalogActivityTime(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	value, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, ErrCatalogActivityFilter
	}
	utc := value.UTC()
	return &utc, nil
}

func validCatalogActivityFilter(f CatalogActivityFilter) bool {
	return f.Limit >= 1 && f.Limit <= 50 && len(f.StoreID) <= 128 && len(f.Query) <= 120 && len(f.Cursor) <= 2048 &&
		(f.Kind == "" || f.Kind == "product" || f.Kind == "offer") &&
		(f.Action == "" || f.Action == "created" || f.Action == "updated" || f.Action == "migrated")
}

func decodeCatalogActivityCursor(f CatalogActivityFilter) (*catalogActivityCursor, error) {
	if f.Cursor == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(f.Cursor)
	if err != nil {
		return nil, ErrCatalogActivityFilter
	}
	var c catalogActivityCursor
	if json.Unmarshal(raw, &c) != nil || c.V != 1 || c.ID < 1 || (c.Kind != "product" && c.Kind != "offer") ||
		c.StoreID != f.StoreID || c.Query != f.Query || c.FilterKind != f.Kind || c.Action != f.Action || c.From != f.From || c.To != f.To {
		return nil, ErrCatalogActivityFilter
	}
	if _, err := time.Parse(time.RFC3339Nano, c.At); err != nil {
		return nil, ErrCatalogActivityFilter
	}
	return &c, nil
}

func ListCatalogActivity(ctx context.Context, db *sql.DB, f CatalogActivityFilter) (CatalogActivityPage, error) {
	f.StoreID = strings.TrimSpace(f.StoreID)
	f.Query = strings.TrimSpace(f.Query)
	f.Cursor = strings.TrimSpace(f.Cursor)
	if !validCatalogActivityFilter(f) {
		return CatalogActivityPage{}, ErrCatalogActivityFilter
	}
	from, err := parseCatalogActivityTime(f.From)
	if err != nil {
		return CatalogActivityPage{}, err
	}
	to, err := parseCatalogActivityTime(f.To)
	if err != nil {
		return CatalogActivityPage{}, err
	}
	if from != nil && to != nil && !from.Before(*to) {
		return CatalogActivityPage{}, ErrCatalogActivityFilter
	}
	cursor, err := decodeCatalogActivityCursor(f)
	if err != nil {
		return CatalogActivityPage{}, err
	}
	var cursorTime *time.Time
	var cursorKind string
	var cursorID int64
	if cursor != nil {
		parsed, _ := time.Parse(time.RFC3339Nano, cursor.At)
		parsed = parsed.UTC()
		cursorTime = &parsed
		cursorKind = cursor.Kind
		cursorID = cursor.ID
	}
	const query = `WITH activity AS (
 SELECT 'product'::text AS kind, a.id, a.event_type, a.acting_actor_id,
  a.canonical_name AS subject, a.product_id AS entity_id, ''::text AS store_id,
  a.created_at AS at, a.result_version, ''::text AS from_state, ''::text AS to_state,
  NULL::bigint AS price_minor, NULL::bigint AS previous_price_minor
 FROM dsh.catalog_product_audit a
 UNION ALL
 SELECT 'offer'::text, a.id, a.event_type, a.acting_actor_id,
  p.canonical_name, a.offer_id, a.store_id, a.created_at, a.result_version,
  COALESCE(a.from_state,''), a.to_state, a.price_minor, a.old_price_minor
 FROM dsh.catalog_store_offer_audit a
 JOIN dsh.catalog_product_variants v ON v.id=a.variant_id
 JOIN dsh.catalog_products p ON p.id=v.product_id
 )
 SELECT kind,id,event_type,acting_actor_id,subject,entity_id,store_id,at,result_version,
 from_state,to_state,price_minor,previous_price_minor
 FROM activity
 WHERE ($1='' OR store_id=$1)
 AND ($2='' OR subject ILIKE '%'||$2||'%' OR acting_actor_id ILIKE '%'||$2||'%')
 AND ($3='' OR kind=$3)
 AND ($4='' OR right(event_type,length($4))=$4)
 AND ($5::timestamptz IS NULL OR at >= $5::timestamptz)
 AND ($6::timestamptz IS NULL OR at < $6::timestamptz)
 AND ($7::timestamptz IS NULL OR (at,kind,id) < ($7::timestamptz,$8::text,$9::bigint))
 ORDER BY at DESC,kind DESC,id DESC LIMIT $10`
	rows, err := db.QueryContext(ctx, query, f.StoreID, f.Query, f.Kind, f.Action, from, to, cursorTime, cursorKind, cursorID, f.Limit+1)
	if err != nil {
		return CatalogActivityPage{}, err
	}
	defer rows.Close()
	page := CatalogActivityPage{Items: make([]CatalogActivityItem, 0, f.Limit)}
	var lastID int64
	for rows.Next() {
		var item CatalogActivityItem
		var id int64
		var event string
		var price, oldPrice sql.NullInt64
		if err := rows.Scan(&item.Kind, &id, &event, &item.ActorID, &item.Subject, &item.EntityID, &item.StoreID, &item.At, &item.Version, &item.FromState, &item.ToState, &price, &oldPrice); err != nil {
			return CatalogActivityPage{}, err
		}
		item.At = item.At.UTC()
		item.ID = fmt.Sprintf("%s-%d", item.Kind, id)
		item.Action = strings.TrimPrefix(strings.TrimPrefix(event, "catalog_product_"), "catalog_store_offer_")
		if price.Valid {
			value := price.Int64
			item.PriceMinor = &value
		}
		if oldPrice.Valid {
			value := oldPrice.Int64
			item.PreviousPriceMinor = &value
		}
		page.Items = append(page.Items, item)
		lastID = id
	}
	if err := rows.Err(); err != nil {
		return CatalogActivityPage{}, err
	}
	if len(page.Items) > f.Limit {
		page.Items = page.Items[:f.Limit]
		last := page.Items[len(page.Items)-1]
		// The final ID belongs to the final retained row, not the overfetch row.
		_, err = fmt.Sscanf(last.ID, last.Kind+"-%d", &lastID)
		if err != nil {
			return CatalogActivityPage{}, err
		}
		token := catalogActivityCursor{V: 1, At: last.At.Format(time.RFC3339Nano), Kind: last.Kind, ID: lastID,
			StoreID: f.StoreID, Query: f.Query, FilterKind: f.Kind, Action: f.Action, From: f.From, To: f.To}
		raw, err := json.Marshal(token)
		if err != nil {
			return CatalogActivityPage{}, err
		}
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return page, nil
}
