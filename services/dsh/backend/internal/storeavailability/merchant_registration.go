package storeavailability

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"math"
	"net/http"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

var (
	ErrRegistrationInvalid       = errors.New("INVALID_STORE_REGISTRATION")
	ErrRegistrationClosed        = errors.New("STORE_REGISTRATION_CLOSED")
	ErrRegistrationPolicyChanged = errors.New("STORE_REGISTRATION_POLICY_CHANGED")
)
var termsVersionRule = regexp.MustCompile(`^[a-z0-9._-]{3,80}$`)
var registrationPublicID = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

// A Store is a DSH resource, never the Merchant's Identity account.
type MerchantRegistrationRequest struct {
	OperationID   string   `json:"operationId"`
	Name          string   `json:"name"`
	CityID        string   `json:"cityId"`
	VerticalID    string   `json:"verticalId"`
	Relation      string   `json:"relation"`
	Latitude      *float64 `json:"latitude"`
	Longitude     *float64 `json:"longitude"`
	PolicyVersion int64    `json:"policyVersion"`
	TermsVersion  string   `json:"termsVersion"`
	AcceptedTerms bool     `json:"acceptedTerms"`
}
type MerchantRegistrationChoice struct {
	CityID        string `json:"cityId"`
	Relation      string `json:"relation"`
	PolicyVersion int64  `json:"policyVersion"`
	TermsVersion  string `json:"termsVersion"`
	TermsText     string `json:"termsText"`
}
type MerchantRegistrationOptions struct {
	Choices   []MerchantRegistrationChoice `json:"choices"`
	Verticals []string                     `json:"verticals"`
}
type MerchantRegistrationResult struct {
	Store  MerchantStore `json:"store"`
	Replay bool          `json:"replay"`
}

type MerchantStoreRegistrar struct {
	identity IdentitySessions
	grants   *PostgresStoreGrants
}

func NewMerchantStoreRegistrar(identity IdentitySessions, grants *PostgresStoreGrants) (*MerchantStoreRegistrar, error) {
	if identity == nil || grants == nil || grants.db == nil || !postgresSchemaRule.MatchString(grants.schema) {
		return nil, ErrStoreOwnerUnavailable
	}
	return &MerchantStoreRegistrar{identity: identity, grants: grants}, nil
}
func (s *MerchantStoreRegistrar) actor(ctx context.Context, token string) (string, error) {
	if token == "" || strings.TrimSpace(token) != token {
		return "", ErrUnauthorized
	}
	a, err := s.identity.ResolveCurrentSession(ctx, token)
	if errors.Is(err, ErrIdentityUnavailable) {
		return "", ErrIdentityUnavailable
	}
	if err != nil {
		return "", ErrUnauthorized
	}
	if !identityaccess.ValidActorID(a.Subject) {
		return "", ErrUnauthorized
	}
	if a.Role != MerchantRole {
		return "", ErrForbidden
	}
	return a.Subject, nil
}
func validateMerchantRegistration(v MerchantRegistrationRequest) error {
	name := strings.TrimSpace(v.Name)
	if !operationIDRule.MatchString(v.OperationID) || len([]rune(name)) < 1 ||
		len([]rune(name)) > 120 || !utf8.ValidString(name) ||
		strings.ContainsFunc(v.Name, unicode.IsControl) ||
		!registrationPublicID.MatchString(v.CityID) || !registrationPublicID.MatchString(v.VerticalID) ||
		(v.Relation != "MARKETPLACE" && v.Relation != "DIRECT") ||
		v.Latitude == nil || v.Longitude == nil || math.IsNaN(*v.Latitude) || math.IsInf(*v.Latitude, 0) ||
		math.IsNaN(*v.Longitude) || math.IsInf(*v.Longitude, 0) ||
		*v.Latitude < -90 || *v.Latitude > 90 || *v.Longitude < -180 || *v.Longitude > 180 ||
		v.PolicyVersion < 1 || !termsVersionRule.MatchString(v.TermsVersion) || !v.AcceptedTerms {
		return ErrRegistrationInvalid
	}
	return nil
}

// Options are read from active DSH city/vertical registries and explicitly enabled
// versioned Store-admission policies. No client invents a city, fee or relation.
func (s *MerchantStoreRegistrar) Options(ctx context.Context, token string) (MerchantRegistrationOptions, error) {
	if _, err := s.actor(ctx, token); err != nil {
		return MerchantRegistrationOptions{}, err
	}
	tx, err := dbscope.Begin(ctx, s.grants.db, s.grants.schema, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead}, "store_registration_policies", "store_registration_terms", "service_cities", "verticals")
	if err != nil {
		return MerchantRegistrationOptions{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	result := MerchantRegistrationOptions{Choices: []MerchantRegistrationChoice{}, Verticals: []string{}}
	rows, err := tx.QueryContext(ctx, `SELECT p.city_id,p.relation,p.version,p.terms_version,t.body FROM store_registration_policies p
        JOIN store_registration_terms t ON t.version=p.terms_version
        JOIN service_cities c ON c.id=p.city_id WHERE p.enabled AND c.active
        ORDER BY p.city_id,p.relation LIMIT 101`)
	if err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	for rows.Next() {
		if len(result.Choices) >= 100 {
			rows.Close()
			return result, ErrStoreOwnerUnavailable
		}
		var choice MerchantRegistrationChoice
		if err = rows.Scan(&choice.CityID, &choice.Relation, &choice.PolicyVersion, &choice.TermsVersion, &choice.TermsText); err != nil {
			rows.Close()
			return result, ErrStoreOwnerUnavailable
		}
		result.Choices = append(result.Choices, choice)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	rows, err = tx.QueryContext(ctx, `SELECT id FROM verticals WHERE active ORDER BY id LIMIT 101`)
	if err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	for rows.Next() {
		if len(result.Verticals) >= 100 {
			rows.Close()
			return result, ErrStoreOwnerUnavailable
		}
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return result, ErrStoreOwnerUnavailable
		}
		result.Verticals = append(result.Verticals, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	// A city/relation policy is not actionable without an active vertical.
	// Keep the empty vertical list so clients can distinguish the cause.
	if len(result.Verticals) == 0 {
		result.Choices = []MerchantRegistrationChoice{}
	}
	if err = tx.Commit(); err != nil {
		return result, ErrStoreOwnerUnavailable
	}
	return result, nil
}

func readRegisteredStore(ctx context.Context, tx *sql.Tx, storeID, actorID string) (MerchantStore, error) {
	var store MerchantStore
	var owner string
	err := tx.QueryRowContext(ctx, `SELECT id,name,relation,published,owner_actor_id
        FROM stores WHERE id=$1`, storeID).Scan(&store.ID, &store.Name, &store.Relation, &store.Published, &owner)
	if err != nil {
		return MerchantStore{}, ErrStoreOwnerUnavailable
	}
	if owner != actorID {
		return MerchantStore{}, ErrForbidden
	}
	return store, nil
}

// Register creates only an unpublished, nonorderable DSH Store. An actor-wide
// advisory transaction lock serializes its own create attempts, including
// retry after an unknown commit, without modifying Identity or WLT state.
func (s *MerchantStoreRegistrar) Register(ctx context.Context, token string, input MerchantRegistrationRequest) (MerchantRegistrationResult, error) {
	actorID, err := s.actor(ctx, token)
	if err != nil {
		return MerchantRegistrationResult{}, err
	}
	if err = validateMerchantRegistration(input); err != nil {
		return MerchantRegistrationResult{}, err
	}
	input.Name = strings.TrimSpace(input.Name)
	body, err := json.Marshal(input)
	if err != nil {
		return MerchantRegistrationResult{}, ErrRegistrationInvalid
	}
	sum := sha256.Sum256(body)
	fingerprint := hex.EncodeToString(sum[:])
	tx, err := dbscope.Begin(ctx, s.grants.db, s.grants.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, "store_registration_commands", "stores", "service_cities", "verticals", "store_registration_policies")
	if err != nil {
		return MerchantRegistrationResult{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(84925, hashtext($1))", actorID); err != nil {
		return MerchantRegistrationResult{}, ErrStoreOwnerUnavailable
	}
	var previousHash, storeID string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,store_id FROM store_registration_commands
        WHERE actor_id=$1 AND operation_id=$2`, actorID, input.OperationID).Scan(&previousHash, &storeID)
	if err == nil {
		if previousHash != fingerprint {
			return MerchantRegistrationResult{}, ErrOperationConflict
		}
		store, readErr := readRegisteredStore(ctx, tx, storeID, actorID)
		if readErr != nil {
			return MerchantRegistrationResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return MerchantRegistrationResult{}, ErrUnknownResult
		}
		return MerchantRegistrationResult{Store: store, Replay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MerchantRegistrationResult{}, ErrStoreOwnerUnavailable
	}
	var activeCity, activeVertical bool
	err = tx.QueryRowContext(ctx, "SELECT active FROM service_cities WHERE id=$1 FOR SHARE", input.CityID).Scan(&activeCity)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantRegistrationResult{}, ErrRegistrationInvalid
	}
	if err != nil {
		return MerchantRegistrationResult{}, ErrStoreOwnerUnavailable
	}
	err = tx.QueryRowContext(ctx, "SELECT active FROM verticals WHERE id=$1 FOR SHARE", input.VerticalID).Scan(&activeVertical)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantRegistrationResult{}, ErrRegistrationInvalid
	}
	if err != nil {
		return MerchantRegistrationResult{}, ErrStoreOwnerUnavailable
	}
	if !activeCity || !activeVertical {
		return MerchantRegistrationResult{}, ErrRegistrationClosed
	}
	var enabled bool
	var policyVersion int64
	var termsVersion string
	err = tx.QueryRowContext(ctx, `SELECT enabled,version,terms_version FROM store_registration_policies
        WHERE city_id=$1 AND relation=$2 FOR SHARE`, input.CityID, input.Relation).
		Scan(&enabled, &policyVersion, &termsVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantRegistrationResult{}, ErrRegistrationClosed
	}
	if err != nil {
		return MerchantRegistrationResult{}, ErrStoreOwnerUnavailable
	}
	if !enabled {
		return MerchantRegistrationResult{}, ErrRegistrationClosed
	}
	if policyVersion != input.PolicyVersion || termsVersion != input.TermsVersion {
		return MerchantRegistrationResult{}, ErrRegistrationPolicyChanged
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM stores WHERE owner_actor_id=$1", actorID).Scan(&count); err != nil {
		return MerchantRegistrationResult{}, ErrStoreOwnerUnavailable
	}
	if count >= 100 {
		return MerchantRegistrationResult{}, ErrRegistrationClosed
	}
	var random [16]byte
	if _, err = rand.Read(random[:]); err != nil {
		return MerchantRegistrationResult{}, ErrStoreOwnerUnavailable
	}
	storeID = "store-" + hex.EncodeToString(random[:])
	_, err = tx.ExecContext(ctx, `INSERT INTO stores
        (id,owner_actor_id,city_id,vertical_id,relation,name,published,latitude,longitude)
        VALUES($1,$2,$3,$4,$5,$6,false,$7,$8)`,
		storeID, actorID, input.CityID, input.VerticalID, input.Relation, input.Name, *input.Latitude, *input.Longitude)
	if err != nil {
		return MerchantRegistrationResult{}, ErrUnknownResult
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO store_registration_commands
        (actor_id,operation_id,request_hash,store_id,policy_version,terms_version)
        VALUES($1,$2,$3,$4,$5,$6)`, actorID, input.OperationID, fingerprint, storeID, policyVersion, termsVersion)
	if err != nil {
		return MerchantRegistrationResult{}, ErrUnknownResult
	}
	if err = tx.Commit(); err != nil {
		return MerchantRegistrationResult{}, ErrUnknownResult
	}
	return MerchantRegistrationResult{Store: MerchantStore{
		ID: storeID, Name: input.Name, Relation: input.Relation, Published: false,
	}, Replay: false}, nil
}

// This handler is mounted only by the already-isolated DSH Merchant writer.
func NewMerchantRegistrationHandler(service *MerchantStoreRegistrar) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/stores/registration-options", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.RawQuery != "" {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		bearer, ok := bearerToken(r)
		if !ok {
			writeRegistrationFailure(w, ErrUnauthorized)
			return
		}
		options, err := service.Options(r.Context(), bearer)
		if err != nil {
			writeRegistrationFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, options)
	})
	mux.HandleFunc("POST /v1/stores", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.RawQuery != "" || r.Header.Get("Origin") != "" ||
			r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeRegistrationFailure(w, ErrForbidden)
			return
		}
		bearer, ok := bearerToken(r)
		if !ok {
			writeRegistrationFailure(w, ErrUnauthorized)
			return
		}
		var request MerchantRegistrationRequest
		if decodeUniqueJSON(w, r, 4096, &request) != nil {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		result, err := service.Register(r.Context(), bearer, request)
		if err != nil {
			writeRegistrationFailure(w, err)
			return
		}
		code := http.StatusCreated
		if result.Replay {
			code = http.StatusOK
		}
		writeJSON(w, code, result)
	})
	return mux
}
func writeRegistrationFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrRegistrationInvalid):
		writeJSON(w, 400, struct {
			Code string `json:"code"`
		}{Code: "INVALID_STORE_REGISTRATION"})
	case errors.Is(err, ErrRegistrationClosed):
		writeJSON(w, 403, struct {
			Code string `json:"code"`
		}{Code: "STORE_REGISTRATION_CLOSED"})
	case errors.Is(err, ErrRegistrationPolicyChanged):
		writeJSON(w, 409, struct {
			Code string `json:"code"`
		}{Code: "STORE_REGISTRATION_POLICY_CHANGED"})
	default:
		writeFailure(w, err)
	}
}
