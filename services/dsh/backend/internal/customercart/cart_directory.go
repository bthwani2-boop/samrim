package customercart

import (
	"context"
	"net/http"
	"net/url"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

const cartDirectoryLimit = 20

type cartDirectoryEntry struct {
	StoreID   string `json:"storeId"`
	StoreName string `json:"storeName"`
	Version   int64  `json:"version"`
	LineCount int    `json:"lineCount"`
}
type cartDirectoryPage struct {
	ActorID    string               `json:"actorId"`
	Carts      []cartDirectoryEntry `json:"carts"`
	NextCursor string               `json:"nextCursor,omitempty"`
}

// A directory of owned drafts, not an Order, quote, fulfillment or payment claim.
func (h *Handler) listCarts(w http.ResponseWriter, r *http.Request) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) > 1 || (len(query) > 0 && (len(query["after"]) != 1 || !resourceRule.MatchString(query.Get("after")))) ||
		r.URL.ForceQuery || r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	token := tokenOf(r)
	actor, status := h.actor(ctx, token)
	if status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	tx, err := h.begin(ctx, false)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	if err = dbscope.Bind(ctx, tx, h.schema, "customer_carts", "customer_cart_lines", "stores", "service_cities", "verticals"); err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	rows, err := tx.QueryContext(ctx, `SELECT c.store_id,
   CASE WHEN s.published AND sc.active AND v.active THEN trim(s.name) ELSE '' END,
   c.version, lines.count
 FROM customer_carts c
 JOIN stores s ON s.id=c.store_id
 JOIN service_cities sc ON sc.id=s.city_id
 JOIN verticals v ON v.id=s.vertical_id
 JOIN LATERAL (SELECT count(*) AS count FROM customer_cart_lines l
   WHERE l.actor_id=c.actor_id AND l.store_id=c.store_id) lines ON lines.count>0
 WHERE c.actor_id=$1 AND c.store_id COLLATE "C">$2
 ORDER BY c.store_id COLLATE "C" LIMIT $3`, actor, query.Get("after"), cartDirectoryLimit+1)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	page := cartDirectoryPage{ActorID: actor, Carts: []cartDirectoryEntry{}}
	for rows.Next() {
		var entry cartDirectoryEntry
		if err = rows.Scan(&entry.StoreID, &entry.StoreName, &entry.Version, &entry.LineCount); err != nil {
			break
		}
		if entry.Version < 1 || entry.Version > 9007199254740991 || entry.LineCount < 1 || entry.LineCount > 20 {
			rows.Close()
			fail(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		page.Carts = append(page.Carts, entry)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if len(page.Carts) > cartDirectoryLimit {
		page.Carts = page.Carts[:cartDirectoryLimit]
		page.NextCursor = page.Carts[cartDirectoryLimit-1].StoreID
	}
	if status = h.stillCurrent(ctx, token, actor); status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if status = h.stillCurrent(ctx, token, actor); status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	reply(w, page)
}
