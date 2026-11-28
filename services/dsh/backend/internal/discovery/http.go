package discovery

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

type Server struct {
	Owner          *Owner
	AllowedOrigins map[string]bool
	// The isolated Store availability capability requires migrations 002–003.
	// Discovery deployments with the public baseline alone can still serve.
	StoreAvailabilityEnabled bool
}
type publicStore struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	CityID             string `json:"cityId"`
	VerticalID         string `json:"verticalId"`
	OrderabilityStatus string `json:"orderabilityStatus"`
	OrderingAvailable  bool   `json:"orderingAvailable"`
}

type publicStoreSelection struct {
	id, city, after, search, vertical string
	limit                             int
}

// The same published/active boundary serves a direct Store link and the
// marketplace listing. Only bound selectors vary; hours-disabled deployments
// must not reference operational tables that have not been installed.
func (s *Server) queryPublicStores(ctx context.Context, tx *sql.Tx, selection publicStoreSelection) (*sql.Rows, error) {
	args := []any{selection.id, selection.city, selection.after, selection.search, selection.vertical, selection.limit,
		searchArabicVariants, searchArabicReplacements}
	if s.StoreAvailabilityEnabled {
		return tx.QueryContext(ctx, storeavailability.PublicStoresWithScheduleSQL, args...)
	}
	return tx.QueryContext(ctx, `SELECT s.id,s.name,s.city_id,s.vertical_id,
		NULL::jsonb, transaction_timestamp()
		FROM stores s
		JOIN service_cities c ON c.id=s.city_id
		JOIN verticals v ON v.id=s.vertical_id
		WHERE s.published AND c.active AND v.active
		  AND (($1::text<>'' AND s.id=$1) OR ($1='' AND s.relation='MARKETPLACE'
			AND s.city_id=$2 AND s.id>$3
			AND ($4='' OR strpos(translate(lower(normalize(s.name)), $7, $8),
				NULLIF(translate(lower(normalize($4)), $7, $8), ''))>0)
			AND ($5='' OR s.vertical_id=$5)))
		ORDER BY s.id LIMIT $6`, args...)
}

func scanPublicStore(scan func(...any) error) (publicStore, error) {
	var st publicStore
	var hoursJSON []byte
	var now time.Time
	if err := scan(&st.ID, &st.Name, &st.CityID, &st.VerticalID, &hoursJSON, &now); err != nil {
		return publicStore{}, err
	}
	// An active pause and a closed schedule are public browse information. A checkout decision
	// still requires the currently unavailable fulfillment and WLT flow.
	st.OrderabilityStatus = string(storeavailability.OperationallyUnavail)
	switch storeavailability.EvaluateCustomerSchedule(now, hoursJSON).Status {
	case "PAUSED":
		st.OrderabilityStatus = string(storeavailability.Paused)
	case "CLOSED_BY_SCHEDULE":
		st.OrderabilityStatus = string(storeavailability.ClosedBySchedule)
	}
	return st, nil
}

// Public verticals are DSH-owned marketplace classifications visible in a
// selected active Service City. Counts exclude drafts and DIRECT Stores.
type publicVerticalSummary struct {
	ID         string `json:"id"`
	StoreCount int64  `json:"storeCount"`
}

type publicOffer struct {
	ID        string         `json:"id"`
	StoreID   string         `json:"storeId"`
	Name      string         `json:"name"`
	VariantID string         `json:"variantId"`
	PriceYER  publicPriceYER `json:"priceYer"`
	Available bool           `json:"available"`
}

type publicPriceYER int64

func (price publicPriceYER) MarshalJSON() ([]byte, error) {
	const maxSafeJSONInteger = 1<<53 - 1
	amount := strconv.FormatInt(int64(price), 10)
	if price > maxSafeJSONInteger {
		return json.Marshal(amount)
	}
	return []byte(amount), nil
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

// Public route admission is shared by the actual GET dispatch and CORS
// preflight. Match the canonical escaped path; an encoded or trailing-slash
// alias must not acquire a different Store or Offer scope.
type publicRouteKind uint8

const (
	publicCities publicRouteKind = iota + 1
	publicVerticals
	publicStores
	publicStoreDetail
	publicOffers
	publicEstimate
)

type publicRoute struct {
	kind             publicRouteKind
	storeID, offerID string
}

func matchPublicRoute(path string) (publicRoute, bool) {
	parts := strings.Split(path, "/")
	if len(parts) < 4 || parts[0] != "" || parts[1] != "v1" || parts[2] != "public" {
		return publicRoute{}, false
	}
	if len(parts) == 4 {
		switch parts[3] {
		case "cities":
			return publicRoute{kind: publicCities}, true
		case "verticals":
			return publicRoute{kind: publicVerticals}, true
		case "stores":
			return publicRoute{kind: publicStores}, true
		}
	}
	if len(parts) < 5 || parts[3] != "stores" || !validID(parts[4]) {
		return publicRoute{}, false
	}
	route := publicRoute{storeID: parts[4]}
	switch {
	case len(parts) == 5:
		route.kind = publicStoreDetail
	case len(parts) == 6 && parts[5] == "offers":
		route.kind = publicOffers
	case len(parts) == 8 && parts[5] == "offers" && validID(parts[6]) && parts[7] == "estimate":
		route.kind, route.offerID = publicEstimate, parts[6]
	default:
		return publicRoute{}, false
	}
	return route, true
}

func (s *Server) publicOrigin(r *http.Request) string {
	origins := r.Header.Values("Origin")
	if len(origins) == 1 && origins[0] != "" && origins[0] != "null" && s.AllowedOrigins[origins[0]] {
		return origins[0]
	}
	return ""
}

func publicReadEnvelope(r *http.Request, route publicRoute) bool {
	return r.ContentLength == 0 && len(r.TransferEncoding) == 0 &&
		(route.kind != publicStoreDetail || (r.URL.RawQuery == "" && !r.URL.ForceQuery))
}

// Preflight describes only an admitted public GET and its supported headers;
// it never enters an owner transaction or grants access to private routes.
func publicPreflight(w http.ResponseWriter, r *http.Request, route publicRoute, matched bool, origin string) {
	w.Header().Set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")
	requested := r.Header.Values("Access-Control-Request-Method")
	if !matched || origin == "" || len(requested) != 1 || requested[0] != http.MethodGet || !publicReadEnvelope(r, route) {
		errorJSON(w, http.StatusForbidden, "ORIGIN_NOT_ALLOWED")
		return
	}
	for _, value := range r.Header.Values("Access-Control-Request-Headers") {
		for _, part := range strings.Split(value, ",") {
			switch strings.ToLower(strings.TrimSpace(part)) {
			case "accept", "content-type":
			default:
				errorJSON(w, http.StatusForbidden, "ORIGIN_NOT_ALLOWED")
				return
			}
		}
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", http.MethodGet)
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.EscapedPath()
	if path == "/health" {
		s.health(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Vary", "Origin")
	origin := s.publicOrigin(r)
	bounded := len(r.URL.RawQuery) <= 4096 && len(path) <= 400
	var route publicRoute
	var matched bool
	if bounded {
		route, matched = matchPublicRoute(path)
	}
	if r.Method == http.MethodOptions {
		publicPreflight(w, r, route, matched, origin)
		return
	}
	// Public reads also serve native and non-browser clients. An untrusted
	// browser Origin receives no CORS grant; it does not become an auth gate.
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		errorJSON(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	if !bounded {
		errorJSON(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	if !matched {
		errorJSON(w, http.StatusNotFound, "NOT_FOUND")
		return
	}
	if !publicReadEnvelope(r, route) {
		errorJSON(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	switch route.kind {
	case publicCities:
		s.listCities(ctx, w, r)
	case publicVerticals:
		s.listVerticals(ctx, w, r)
	case publicStores:
		s.listStores(ctx, w, r)
	case publicStoreDetail:
		s.storeDetail(ctx, w, route.storeID)
	case publicOffers:
		s.listOffers(ctx, w, r, route.storeID)
	case publicEstimate:
		s.estimateOffer(ctx, w, r, route.storeID, route.offerID)
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		errorJSON(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	tx, err := s.Owner.viewTx(ctx, "public_revision")
	if err == nil {
		defer tx.Rollback()
		_, err = s.Owner.revision(ctx, tx)
	}
	if err != nil {
		errorJSON(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"service": "dsh", "status": "ok"})
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
	values, present := r.URL.Query()["limit"]
	if !present {
		return 20, true
	}
	if len(values) != 1 {
		return 0, false
	}
	n, e := strconv.Atoi(values[0])
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

// viewTx admits only a repeatable owner snapshot whose required relations
// resolve to the validated DSH schema, not an implicit temporary relation.
func (o *Owner) viewTx(ctx context.Context, firstRelation string, additionalRelations ...string) (*sql.Tx, error) {
	if o == nil {
		return nil, errors.New("DSH owner unavailable")
	}
	relations := append([]string{firstRelation}, additionalRelations...)
	return dbscope.Begin(ctx, o.DB, o.Schema, &sql.TxOptions{
		ReadOnly: true, Isolation: sql.LevelRepeatableRead,
	}, relations...)
}

// All Store projections share admission; optional schedule relations are
// required only when enabled. Catalog readers add their required relations.
func (s *Server) storeViewTx(ctx context.Context, catalogRelations ...string) (*sql.Tx, error) {
	relations := []string{"stores", "service_cities", "verticals"}
	if s.StoreAvailabilityEnabled {
		relations = append(relations, "store_operational_availability", "store_operational_weekly_hours")
	}
	relations = append(relations, catalogRelations...)
	return s.Owner.viewTx(ctx, "public_revision", relations...)
}
func cursorError(w http.ResponseWriter, err error) {
	if errors.Is(err, errStale) {
		errorJSON(w, 409, "STALE_CURSOR")
		return
	}
	errorJSON(w, 400, "INVALID_CURSOR")
}
