package customercart

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

// A Customer cart is a DSH-owned draft. It is neither an Order nor a price,
// stock, fulfillment, or WLT financial reservation.
type Line struct {
	OfferID          string `json:"offerId"`
	VariantID        string `json:"variantId"`
	Name             string `json:"name"`
	Quantity         int64  `json:"quantity"`
	PreviewUnitYER   string `json:"previewUnitYer"`
	PreviewAvailable bool   `json:"previewAvailable"`
}
type Snapshot struct {
	ActorID string `json:"actorId"`
	StoreID string `json:"storeId"`
	Version int64  `json:"version"`
	Lines   []Line `json:"lines"`
}
type Change struct {
	OperationID     string `json:"operationId"`
	ExpectedVersion *int64 `json:"expectedVersion"`
	Lines           []struct {
		OfferID  string `json:"offerId"`
		Quantity int64  `json:"quantity"`
	} `json:"lines"`
}
type ChangeResult struct {
	Cart   Snapshot `json:"cart"`
	Replay bool     `json:"replay"`
}
type Identity interface {
	ResolveCurrentSession(context.Context, string) (identityaccess.VerifiedActor, error)
}
type Handler struct {
	db       *sql.DB
	schema   string
	identity Identity
}

var schemaRule = regexp.MustCompile(`^dsh_test_[a-z0-9_]{1,50}$`)
var resourceRule = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)
var operationRule = regexp.MustCompile(`^[A-Za-z0-9._-]{8,128}$`)
var tokenRule = regexp.MustCompile(`^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$`)

func NewHandler(db *sql.DB, schema string, identity Identity) (http.Handler, error) {
	if db == nil || identity == nil || !schemaRule.MatchString(schema) {
		return nil, errors.New("Customer Cart requires isolated DSH owner and Identity")
	}
	h := &Handler{db: db, schema: schema, identity: identity}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/carts/{storeID}", h.get)
	mux.HandleFunc("GET /v1/carts/{storeID}/merchandise-estimate", h.merchandiseEstimate)
	mux.HandleFunc("GET /v1/carts/{storeID}/serviceability", h.deliveryServiceability)
	mux.HandleFunc("POST /v1/carts/{storeID}/checkout-review", h.checkoutReview)
	mux.HandleFunc("PUT /v1/carts/{storeID}", h.put)
	mux.HandleFunc("GET /v1/addresses", h.listAddresses)
	mux.HandleFunc("GET /v1/addresses/{addressID}", h.getAddress)
	mux.HandleFunc("PUT /v1/addresses/{addressID}", h.saveAddress)
	return mux, nil
}
func fail(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}
func reply(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_ = json.NewEncoder(w).Encode(value)
}
func tokenOf(r *http.Request) string {
	values := r.Header.Values("Authorization")
	if len(values) != 1 {
		return ""
	}
	v, ok := strings.CutPrefix(values[0], "Bearer ")
	if !ok || !tokenRule.MatchString(v) {
		return ""
	}
	return v
}
func (h *Handler) actor(ctx context.Context, token string) (string, int) {
	if token == "" {
		return "", http.StatusUnauthorized
	}
	subject, err := h.identity.ResolveCurrentSession(ctx, token)
	switch {
	case errors.Is(err, identityaccess.ErrIdentityUnavailable):
		return "", http.StatusServiceUnavailable
	case err != nil:
		return "", http.StatusUnauthorized
	case subject.Role != identityaccess.CustomerRole:
		return "", http.StatusForbidden
	case subject.Subject == "" || len(subject.Subject) > 128 || strings.TrimSpace(subject.Subject) != subject.Subject:
		return "", http.StatusUnauthorized
	default:
		return subject.Subject, http.StatusOK
	}
}
func (h *Handler) stillCurrent(ctx context.Context, token, actor string) int {
	current, status := h.actor(ctx, token)
	if status != http.StatusOK {
		return status
	}
	if current != actor {
		return http.StatusUnauthorized
	}
	return http.StatusOK
}
func (h *Handler) begin(ctx context.Context, write bool) (*sql.Tx, error) {
	level := sql.LevelReadCommitted
	if !write {
		level = sql.LevelRepeatableRead
	}
	tx, err := h.db.BeginTx(ctx, &sql.TxOptions{Isolation: level, ReadOnly: !write})
	if err != nil {
		return nil, err
	}
	// A test schema name and a process toggle do not prove database isolation.
	// Never run Customer draft reads/writes against a protected or donor DB.
	var databaseName, currentRole string
	if err = tx.QueryRowContext(ctx, "SELECT pg_catalog.current_database(), current_user").Scan(&databaseName, &currentRole); err != nil ||
		!dbscope.IsCartPrincipal(databaseName, currentRole) {
		_ = tx.Rollback()
		return nil, errors.New("Customer Cart requires an isolated DSH database and role")
	}
	if err = dbscope.Bind(ctx, tx, h.schema); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

const getLinesSQL = `SELECT l.offer_id,o.variant_id,p.name,l.quantity,o.price_yer::text,
    (s.published AND c.active AND vt.active AND p.active AND v.sellable AND
       v.required_attributes_valid AND o.published AND o.available AND
       o.price_yer > 0 AND o.stock_units >= l.quantity)
    FROM customer_cart_lines l
    JOIN offers o ON o.id=l.offer_id AND o.store_id=l.store_id
    JOIN products p ON p.id=o.product_id
    JOIN variants v ON v.id=o.variant_id
    JOIN stores s ON s.id=l.store_id
    JOIN service_cities c ON c.id=s.city_id
    JOIN verticals vt ON vt.id=s.vertical_id
    WHERE l.actor_id=$1 AND l.store_id=$2 ORDER BY l.offer_id`

func snapshot(ctx context.Context, tx *sql.Tx, actor, store string) (Snapshot, error) {
	result := Snapshot{ActorID: actor, StoreID: store, Lines: []Line{}}
	err := tx.QueryRowContext(ctx, `SELECT version FROM customer_carts WHERE actor_id=$1 AND store_id=$2`, actor, store).Scan(&result.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, getLinesSQL, actor, store)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var line Line
		if err = rows.Scan(&line.OfferID, &line.VariantID, &line.Name, &line.Quantity, &line.PreviewUnitYER, &line.PreviewAvailable); err != nil {
			return result, err
		}
		result.Lines = append(result.Lines, line)
	}
	return result, rows.Err()
}
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	if !resourceRule.MatchString(r.PathValue("storeID")) || r.URL.RawQuery != "" || r.URL.ForceQuery ||
		r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	token := tokenOf(r)
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
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
	value, err := snapshot(ctx, tx, actor, r.PathValue("storeID"))
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
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
	reply(w, value)
}
func validChange(change Change) bool {
	if !operationRule.MatchString(change.OperationID) || change.ExpectedVersion == nil || *change.ExpectedVersion < 0 ||
		change.Lines == nil || len(change.Lines) > 20 {
		return false
	}
	seen := map[string]bool{}
	for _, line := range change.Lines {
		if !resourceRule.MatchString(line.OfferID) || line.Quantity < 1 || line.Quantity > 2147483647 || seen[line.OfferID] {
			return false
		}
		seen[line.OfferID] = true
	}
	return true
}
func (h *Handler) put(w http.ResponseWriter, r *http.Request) {
	store := r.PathValue("storeID")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if !resourceRule.MatchString(store) || media != "application/json" || err != nil ||
		r.URL.RawQuery != "" || r.URL.ForceQuery {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var change Change
	if decoder.Decode(&change) != nil || decoder.Decode(new(any)) != io.EOF || !validChange(change) {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	token := tokenOf(r)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	actor, status := h.actor(ctx, token)
	if status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	// Canonicalize line order for stable replay identity. This is a DSH
	// draft; the client cannot submit prices, actors, variants or totals.
	sort.Slice(change.Lines, func(i, j int) bool { return change.Lines[i].OfferID < change.Lines[j].OfferID })
	material, _ := json.Marshal(change)
	digest := sha256.Sum256(material)
	result, status := h.change(ctx, actor, store, token, change, digest[:])
	if status != 200 {
		code := "OPERATION_RESULT_UNKNOWN"
		if status == 409 {
			code = "CART_VERSION_OR_OPERATION_CONFLICT"
		}
		if status == 404 {
			code = "STORE_OR_OFFER_NOT_AVAILABLE"
		}
		if status == 401 || status == 403 {
			code = "UNAUTHORIZED"
		}
		fail(w, status, code)
		return
	}
	reply(w, result)
}
func (h *Handler) change(ctx context.Context, actor, store, token string, change Change, digest []byte) (ChangeResult, int) {
	tx, err := h.begin(ctx, true)
	if err != nil {
		return ChangeResult{}, 503
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO customer_carts(actor_id,store_id,version)
        VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, actor, store)
	if err != nil {
		return ChangeResult{}, 503
	}
	var current int64
	if err = tx.QueryRowContext(ctx, `SELECT version FROM customer_carts
        WHERE actor_id=$1 AND store_id=$2 FOR UPDATE`, actor, store).Scan(&current); err != nil {
		return ChangeResult{}, 503
	}
	var previousDigest []byte
	var previousVersion int64
	err = tx.QueryRowContext(ctx, `SELECT payload_hash,version FROM customer_cart_commands
        WHERE actor_id=$1 AND store_id=$2 AND operation_id=$3`, actor, store, change.OperationID).
		Scan(&previousDigest, &previousVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ChangeResult{}, 503
	}
	if err == nil {
		if !bytes.Equal(previousDigest, digest) || current != previousVersion {
			return ChangeResult{}, 409
		}
		result, readErr := snapshot(ctx, tx, actor, store)
		if readErr != nil {
			return ChangeResult{}, 503
		}
		if status := h.stillCurrent(ctx, token, actor); status != 200 {
			return ChangeResult{}, status
		}
		if tx.Commit() != nil {
			return ChangeResult{}, 503
		}
		return ChangeResult{Cart: result, Replay: true}, 200
	}
	if current != *change.ExpectedVersion {
		return ChangeResult{}, 409
	}
	// Replays of an already committed draft must be possible after a Store
	// closes, loses publication, or runs out of stock. Only a *new* mutation
	// checks current eligibility; the original operation remains readbackable.
	if len(change.Lines) > 0 {
		var allowed bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(
            SELECT 1 FROM stores s JOIN service_cities c ON c.id=s.city_id
            JOIN verticals v ON v.id=s.vertical_id
            WHERE s.id=$1 AND s.published AND c.active AND v.active)`, store).Scan(&allowed)
		if err != nil {
			return ChangeResult{}, 503
		}
		if !allowed {
			return ChangeResult{}, 404
		}
	}
	// The current DSH Offer/Store is consulted for every line; neither a
	// browser estimate nor a cart draft reserves any stock or price.
	for _, line := range change.Lines {
		var allowed bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(
            SELECT 1 FROM offers o JOIN products p ON p.id=o.product_id
            JOIN variants v ON v.id=o.variant_id
            WHERE o.id=$1 AND o.store_id=$2 AND o.published AND o.available
                AND o.price_yer>0 AND o.stock_units >= $3
                AND p.active AND v.sellable AND v.required_attributes_valid)`,
			line.OfferID, store, line.Quantity).Scan(&allowed)
		if err != nil {
			return ChangeResult{}, 503
		}
		if !allowed {
			return ChangeResult{}, 404
		}
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM customer_cart_lines WHERE actor_id=$1 AND store_id=$2`, actor, store); err != nil {
		return ChangeResult{}, 503
	}
	for _, line := range change.Lines {
		if _, err = tx.ExecContext(ctx, `INSERT INTO customer_cart_lines(actor_id,store_id,offer_id,quantity)
            VALUES ($1,$2,$3,$4)`, actor, store, line.OfferID, line.Quantity); err != nil {
			return ChangeResult{}, 503
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE customer_carts SET version=version+1,updated_at=transaction_timestamp()
        WHERE actor_id=$1 AND store_id=$2`, actor, store); err != nil {
		return ChangeResult{}, 503
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO customer_cart_commands(actor_id,store_id,operation_id,payload_hash,version)
        VALUES ($1,$2,$3,$4,$5)`, actor, store, change.OperationID, digest, current+1); err != nil {
		return ChangeResult{}, 503
	}
	value, err := snapshot(ctx, tx, actor, store)
	if err != nil {
		return ChangeResult{}, 503
	}
	if status := h.stillCurrent(ctx, token, actor); status != 200 {
		return ChangeResult{}, status
	}
	if err = tx.Commit(); err != nil {
		return ChangeResult{}, 503
	}
	return ChangeResult{Cart: value, Replay: false}, 200
}
