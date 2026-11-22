package discovery

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
)

func (s *Server) visibleStore(ctx context.Context, tx *sql.Tx, id string) (publicStore, error) {
	q := `SELECT s.id,s.name,s.city_id,s.vertical_id,` + s.publicHoursSQL() + ` FROM stores s
		JOIN service_cities c ON c.id=s.city_id
		JOIN verticals v ON v.id=s.vertical_id
		WHERE s.id=$1 AND s.published AND c.active AND v.active`
	return scanPublicStore(tx.QueryRowContext(ctx, q, id).Scan)
}
func (s *Server) storeDetail(ctx context.Context, w http.ResponseWriter, id string) {
	tx, e := s.Owner.viewTx(ctx)
	if e != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	st, e := s.visibleStore(ctx, tx, id)
	if errors.Is(e, sql.ErrNoRows) {
		errorJSON(w, 404, "NOT_FOUND")
		return
	}
	if e != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if e = tx.Commit(); e != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	jsonResponse(w, 200, st)
}

const visibleOffersSQL = ` FROM offers o
	JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
	JOIN variants v ON v.id=o.variant_id AND v.product_id=o.product_id
	WHERE o.store_id=$1 AND p.active AND v.sellable AND v.required_attributes_valid
		AND o.published AND o.available AND o.price_yer>0 AND o.stock_units>0`

func (s *Server) listOffers(ctx context.Context, w http.ResponseWriter, r *http.Request, id string) {
	search, scope, valid := publicSearch(r, id)
	if !valid {
		errorJSON(w, 400, "INVALID_SEARCH")
		return
	}
	limit, ok := limitParam(r)
	if !ok {
		errorJSON(w, 400, "INVALID_LIMIT")
		return
	}
	tx, err := s.Owner.viewTx(ctx)
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	_, err = s.visibleStore(ctx, tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		errorJSON(w, 404, "NOT_FOUND")
		return
	}
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	rev, err := s.Owner.revision(ctx, tx)
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	after, err := parseCursor(r.URL.Query().Get("cursor"), "offers", scope, rev)
	if err != nil {
		cursorError(w, err)
		return
	}
	q := `SELECT o.id,o.store_id,p.name,o.variant_id,o.price_yer` + visibleOffersSQL +
		` AND o.id>$2 AND strpos(lower(p.name),lower($4))>0 ORDER BY o.id LIMIT $3`
	rows, err := tx.QueryContext(ctx, q, id, after, limit+1, search)
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	items := make([]publicOffer, 0, limit+1)
	for rows.Next() {
		var off publicOffer
		if e := rows.Scan(&off.ID, &off.StoreID, &off.Name, &off.VariantID, &off.PriceYER); e != nil {
			err = e
			break
		}
		off.Available = true
		items = append(items, off)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if err = tx.Commit(); err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	result := page[publicOffer]{Items: items, Revision: rev}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = makeCursor(pageCursor{Kind: "offers", Scope: scope, After: items[limit-1].ID, Revision: rev})
	}
	jsonResponse(w, 200, result)
}
