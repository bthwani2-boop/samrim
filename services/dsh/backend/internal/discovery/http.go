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
	args := []any{selection.id, selection.city, selection.after, selection.search, selection.vertical, selection.limit}
	if s.StoreAvailabilityEnabled {
		return tx.QueryContext(ctx, `SELECT s.id,s.name,s.city_id,s.vertical_id,`+storeavailability.PublicScheduleSQL+`,
			transaction_timestamp()
			FROM stores s
			JOIN service_cities c ON c.id=s.city_id
			JOIN verticals v ON v.id=s.vertical_id
			WHERE s.published AND c.active AND v.active
			  AND (($1::text<>'' AND s.id=$1) OR ($1='' AND s.relation='MARKETPLACE'
				AND s.city_id=$2 AND s.id>$3 AND strpos(lower(s.name),lower($4))>0
				AND ($5='' OR s.vertical_id=$5)))
			ORDER BY s.id LIMIT $6`, args...)
	}
	return tx.QueryContext(ctx, `SELECT s.id,s.name,s.city_id,s.vertical_id,
		NULL::jsonb, transaction_timestamp()
		FROM stores s
		JOIN service_cities c ON c.id=s.city_id
		JOIN verticals v ON v.id=s.vertical_id
		WHERE s.published AND c.active AND v.active
		  AND (($1::text<>'' AND s.id=$1) OR ($1='' AND s.relation='MARKETPLACE'
			AND s.city_id=$2 AND s.id>$3 AND strpos(lower(s.name),lower($4))>0
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
	if len(segments) < 3 || segments[0] != "v1" || segments[1] != "public" {
		errorJSON(w, 404, "NOT_FOUND")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	switch {
	case len(segments) == 3 && segments[2] == "cities":
		s.listCities(ctx, w, r)
	case len(segments) == 3 && segments[2] == "verticals":
		s.listVerticals(ctx, w, r)
	case len(segments) == 3 && segments[2] == "stores":
		s.listStores(ctx, w, r)
	case len(segments) == 4 && segments[2] == "stores" && validID(segments[3]):
		s.storeDetail(ctx, w, segments[3])
	case len(segments) == 5 && segments[2] == "stores" && validID(segments[3]) && segments[4] == "offers":
		s.listOffers(ctx, w, r, segments[3])
	case len(segments) == 7 && segments[2] == "stores" && validID(segments[3]) &&
		segments[4] == "offers" && validID(segments[5]) && segments[6] == "estimate":
		s.estimateOffer(ctx, w, r, segments[3], segments[5])
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
