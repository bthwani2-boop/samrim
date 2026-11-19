package discovery

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

type Server struct {
	Owner          *Owner
	AllowedOrigins map[string]bool
}
type publicStore struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	CityID             string `json:"cityId"`
	VerticalID         string `json:"verticalId"`
	OrderabilityStatus string `json:"orderabilityStatus"`
	OrderingAvailable  bool   `json:"orderingAvailable"`
}
type publicOffer struct {
	ID        string `json:"id"`
	StoreID   string `json:"storeId"`
	Name      string `json:"name"`
	VariantID string `json:"variantId"`
	PriceYER  int64  `json:"priceYer"`
	Available bool   `json:"available"`
}
type page[T any] struct {
	Items      []T    `json:"items"`
	NextCursor string `json:"nextCursor,omitempty"`
	Revision   int64  `json:"revision"`
}
type pageCursor struct {
	Kind     string `json:"kind"`
	Scope    string `json:"scope"`
	After    string `json:"after"`
	Revision int64  `json:"revision"`
}

var errStale = errors.New("cursor is stale")
var errInvalid = errors.New("invalid cursor")

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/health" {
		if r.Method != "GET" {
			errorJSON(w, 405, "METHOD_NOT_ALLOWED")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		tx, err := s.Owner.viewTx(ctx)
		if err == nil {
			defer tx.Rollback()
			// The revision row is initialized by the baseline discovery migration.
			_, err = s.Owner.revision(ctx, tx)
		}
		if err != nil {
			errorJSON(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		jsonResponse(w, 200, map[string]string{"service": "dsh", "status": "ok"})
		return
	}
	origin := r.Header.Get("Origin")
	if origin != "" && s.AllowedOrigins[origin] {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
	}
	if r.Method == "OPTIONS" {
		if origin != "" && !s.AllowedOrigins[origin] {
			errorJSON(w, 403, "ORIGIN_NOT_ALLOWED")
			return
		}
		w.WriteHeader(204)
		return
	}
	if r.Method != "GET" {
		errorJSON(w, 405, "METHOD_NOT_ALLOWED")
		return
	}
	if len(r.URL.RawQuery) > 4096 || len(r.URL.Path) > 400 {
		errorJSON(w, 400, "INVALID_REQUEST")
		return
	}
	segments := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(segments) < 3 || segments[0] != "v1" || segments[1] != "public" || segments[2] != "stores" {
		errorJSON(w, 404, "NOT_FOUND")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	switch {
	case len(segments) == 3:
		s.listStores(ctx, w, r)
	case len(segments) == 4 && validID(segments[3]):
		s.storeDetail(ctx, w, segments[3])
	case len(segments) == 5 && validID(segments[3]) && segments[4] == "offers":
		s.listOffers(ctx, w, r, segments[3])
	default:
		errorJSON(w, 404, "NOT_FOUND")
	}
}
func validID(v string) bool {
	if len(v) == 0 || len(v) > 64 {
		return false
	}
	for _, c := range v {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return true
}
func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func errorJSON(w http.ResponseWriter, status int, code string) {
	jsonResponse(w, status, map[string]string{"error": code})
}
func limitParam(r *http.Request) (int, bool) {
	v := r.URL.Query().Get("limit")
	if v == "" {
		return 20, true
	}
	n, e := strconv.Atoi(v)
	return n, e == nil && n >= 1 && n <= 50
}
func makeCursor(c pageCursor) string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}
func parseCursor(raw, kind, scope string, rev int64) (string, error) {
	if raw == "" {
		return "", nil
	}
	if len(raw) > 512 {
		return "", errInvalid
	}
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil {
		return "", errInvalid
	}
	var c pageCursor
	if e = json.Unmarshal(b, &c); e != nil || c.Kind != kind || c.Scope != scope || !validID(c.After) || c.Revision <= 0 {
		return "", errInvalid
	}
	if c.Revision != rev {
		return "", errStale
	}
	return c.After, nil
}
func (o *Owner) viewTx(ctx context.Context) (*sql.Tx, error) {
	return o.beginScopedTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
}
func cursorError(w http.ResponseWriter, err error) {
	if errors.Is(err, errStale) {
		errorJSON(w, 409, "STALE_CURSOR")
		return
	}
	errorJSON(w, 400, "INVALID_CURSOR")
}
func (s *Server) listStores(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	search, scope, valid := publicSearch(r, r.URL.Query().Get("city_id"))
	if !valid {
		errorJSON(w, 400, "INVALID_SEARCH")
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
	q := `SELECT s.id,s.name,s.city_id,s.vertical_id FROM stores s
		JOIN service_cities c ON c.id=s.city_id
		JOIN verticals v ON v.id=s.vertical_id
		WHERE c.active AND v.active AND s.published AND s.relation='MARKETPLACE'
			AND s.city_id=$1 AND s.id>$2 AND strpos(lower(s.name),lower($4))>0 ORDER BY s.id LIMIT $3`
	rows, err := tx.QueryContext(ctx, q, city, after, limit+1, search)
	if err != nil {
		errorJSON(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	items := make([]publicStore, 0, limit+1)
	for rows.Next() {
		var st publicStore
		if e := rows.Scan(&st.ID, &st.Name, &st.CityID, &st.VerticalID); e != nil {
			err = e
			break
		}
		// Discovery does not create checkout or bypass fulfillment/WLT activation.
		st.OrderabilityStatus = string(storeavailability.OperationallyUnavail)
		st.OrderingAvailable = false
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
func (s *Server) visibleStore(ctx context.Context, tx *sql.Tx, id string) (publicStore, error) {
	var st publicStore
	q := `SELECT s.id,s.name,s.city_id,s.vertical_id FROM stores s
		JOIN service_cities c ON c.id=s.city_id
		JOIN verticals v ON v.id=s.vertical_id
		WHERE s.id=$1 AND s.published AND c.active AND v.active`
	e := tx.QueryRowContext(ctx, q, id).Scan(&st.ID, &st.Name, &st.CityID, &st.VerticalID)
	st.OrderabilityStatus = string(storeavailability.OperationallyUnavail)
	st.OrderingAvailable = false
	return st, e
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
	q := `SELECT o.id,o.store_id,p.name,o.variant_id,o.price_yer FROM offers o
		JOIN products p ON p.id=o.product_id AND p.store_id=o.store_id
		JOIN variants v ON v.id=o.variant_id AND v.product_id=o.product_id
		WHERE o.store_id=$1 AND o.id>$2 AND p.active AND v.sellable
			AND v.required_attributes_valid AND o.published AND o.available
			AND o.price_yer>0 AND o.stock_units>0
			AND strpos(lower(p.name),lower($4))>0 ORDER BY o.id LIMIT $3`
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
