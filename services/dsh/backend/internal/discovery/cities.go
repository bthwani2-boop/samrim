package discovery

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
)

func (s *Server) listCities(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		errorJSON(w, 400, "INVALID_REQUEST")
		return
	}
	for key, entries := range values {
		if (key != "limit" && key != "cursor") || len(entries) != 1 {
			errorJSON(w, 400, "INVALID_REQUEST")
			return
		}
	}
	rawCursor := values.Get("cursor")
	if values.Has("cursor") && (len(rawCursor) == 0 || len(rawCursor) > 512) {
		errorJSON(w, 400, "INVALID_CURSOR")
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
	rev, err := s.Owner.revision(ctx, tx)
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	const scope = "active"
	after, err := parseCursor(rawCursor, "cities", scope, rev)
	if err != nil {
		cursorError(w, err)
		return
	}
	items, err := readActiveCities(ctx, tx, after, limit+1)
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if err = tx.Commit(); err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	result := page[string]{Items: items, Revision: rev}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = makeCursor(pageCursor{Kind: "cities", Scope: scope, After: items[limit-1], Revision: rev})
	}
	jsonResponse(w, 200, result)
}

func readActiveCities(ctx context.Context, tx *sql.Tx, after string, limit int) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM service_cities WHERE active AND id>$1 ORDER BY id LIMIT $2`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cities := make([]string, 0, limit)
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		cities = append(cities, id)
	}
	return cities, rows.Err()
}
