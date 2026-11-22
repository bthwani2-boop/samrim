package discovery

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

// listVerticals projects the DSH vertical identities with currently published
// MARKETPLACE Stores. It never creates a second taxonomy or checkout decision.
func (s *Server) listVerticals(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	values, parseErr := url.ParseQuery(r.URL.RawQuery)
	if parseErr != nil || len(values["city_id"]) != 1 ||
		len(values["limit"]) > 1 || len(values["cursor"]) > 1 || len(values) > 3 ||
		(values.Has("cursor") && values.Get("cursor") == "") {
		errorJSON(w, 400, "INVALID_REQUEST")
		return
	}
	for key := range values {
		if key != "city_id" && key != "limit" && key != "cursor" {
			errorJSON(w, 400, "INVALID_REQUEST")
			return
		}
	}
	city := values.Get("city_id")
	if !validID(city) {
		errorJSON(w, 400, "INVALID_CITY")
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
	after, err := parseCursor(r.URL.Query().Get("cursor"), "verticals", city, rev)
	if err != nil {
		cursorError(w, err)
		return
	}
	rows, err := tx.QueryContext(ctx, `SELECT v.id, COUNT(s.id) FROM stores s
		JOIN verticals v ON v.id=s.vertical_id
		JOIN service_cities c ON c.id=s.city_id
		WHERE s.city_id=$1 AND c.active AND v.active AND s.published
		  AND s.relation='MARKETPLACE' AND v.id>$2
		GROUP BY v.id ORDER BY v.id LIMIT $3`, city, after, limit+1)
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	items := make([]publicVerticalSummary, 0, limit+1)
	for rows.Next() {
		var item publicVerticalSummary
		if e := rows.Scan(&item.ID, &item.StoreCount); e != nil {
			err = e
			break
		}
		items = append(items, item)
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
	result := page[publicVerticalSummary]{Items: items, Revision: rev}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = makeCursor(pageCursor{Kind: "verticals", Scope: city, After: items[limit-1].ID, Revision: rev})
	}
	jsonResponse(w, 200, result)
}

// Public list endpoints accept only their documented, single-valued query
// selectors. Unknown keys and duplicate scopes must never reach owner SQL.
func validPublicListSelectors(r *http.Request, stores bool) bool {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return false
	}
	for key, supplied := range values {
		if len(supplied) != 1 || (key == "cursor" && supplied[0] == "") {
			return false
		}
		switch key {
		case "q", "limit", "cursor":
			// Both Store and Offer listings support these bounded selectors.
		case "city_id", "vertical_id":
			if !stores {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func (s *Server) listStores(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	search, scope, valid := publicSearch(r, r.URL.Query().Get("city_id"))
	if !valid {
		errorJSON(w, 400, "INVALID_SEARCH")
		return
	}
	vertical, verticalValid := publicVertical(r)
	if !verticalValid {
		errorJSON(w, 400, "INVALID_VERTICAL")
		return
	}
	scope = scopedStoreCursor(scope, vertical)
	if !validPublicListSelectors(r, true) {
		errorJSON(w, 400, "INVALID_REQUEST")
		return
	}
	city := r.URL.Query().Get("city_id")
	if !validID(city) {
		errorJSON(w, 400, "INVALID_CITY")
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
	after, err := parseCursor(r.URL.Query().Get("cursor"), "stores", scope, rev)
	if err != nil {
		cursorError(w, err)
		return
	}
	q := `SELECT s.id,s.name,s.city_id,s.vertical_id,` + s.publicHoursSQL() + ` FROM stores s
		JOIN service_cities c ON c.id=s.city_id
		JOIN verticals v ON v.id=s.vertical_id
		WHERE c.active AND v.active AND s.published AND s.relation='MARKETPLACE'
			AND s.city_id=$1 AND s.id>$2 AND strpos(lower(s.name),lower($4))>0
			AND ($5='' OR s.vertical_id=$5) ORDER BY s.id LIMIT $3`
	rows, err := tx.QueryContext(ctx, q, city, after, limit+1, search, vertical)
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	items := make([]publicStore, 0, limit+1)
	for rows.Next() {
		st, e := scanPublicStore(rows.Scan)
		if e != nil {
			err = e
			break
		}
		items = append(items, st)
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
	result := page[publicStore]{Items: items, Revision: rev}
	if len(items) > limit {
		result.Items = items[:limit]
		result.NextCursor = makeCursor(pageCursor{Kind: "stores", Scope: scope, After: items[limit-1].ID, Revision: rev})
	}
	jsonResponse(w, 200, result)
}

// Search is a literal substring, never a SQL LIKE pattern. Hashing its scope
// keeps even multi-byte search text within the existing bounded cursor format.
func publicSearch(r *http.Request, scope string) (string, string, bool) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(values["q"]) > 1 {
		return "", "", false
	}
	raw := values.Get("q")
	if !utf8.ValidString(raw) || utf8.RuneCountInString(raw) > 80 || strings.ContainsRune(raw, 0) {
		return "", "", false
	}
	search := strings.TrimSpace(raw)
	if search != "" {
		scope += fmt.Sprintf(":%x", sha256.Sum256([]byte(search)))
	}
	return search, scope, true
}

// An optional vertical is an exact DSH-owned classification, not a client-side
// Store permission or evidence that this activity is currently available.
func publicVertical(r *http.Request) (string, bool) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return "", false
	}
	provided := values["vertical_id"]
	if len(provided) == 0 {
		return "", true
	}
	if len(provided) != 1 || !validID(provided[0]) {
		return "", false
	}
	return provided[0], true
}

func scopedStoreCursor(scope, vertical string) string {
	if vertical == "" {
		return scope // Preserve existing unfiltered page cursors.
	}
	return scope + ":vertical:" + vertical
}
