package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

var ErrStoreProfileVersionConflict = errors.New("STORE_PROFILE_VERSION_CONFLICT")

// Store profile is an owned draft projection, not publication or location authority.
type MerchantStoreProfile struct {
	StoreID     string `json:"storeId"`
	ActorID     string `json:"actorId"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Published   bool   `json:"published"`
	Version     int64  `json:"version"`
}
type MerchantStoreProfileChange struct {
	OperationID     string `json:"operationId"`
	ExpectedVersion int64  `json:"expectedVersion"`
	Name            string `json:"name"`
	Description     string `json:"description"`
}
type MerchantStoreProfileResult struct {
	Profile MerchantStoreProfile `json:"profile"`
	Replay  bool                 `json:"replay"`
}

func validProfileText(s string, min, max int) bool {
	return utf8.ValidString(s) && s == strings.TrimSpace(s) && utf8.RuneCountInString(s) >= min && utf8.RuneCountInString(s) <= max && !strings.ContainsFunc(s, unicode.IsControl)
}
func validateProfileChange(c MerchantStoreProfileChange) bool {
	return operationIDRule.MatchString(c.OperationID) && c.ExpectedVersion >= 1 && c.ExpectedVersion < 9007199254740991 && validProfileText(c.Name, 1, 120) && validProfileText(c.Description, 0, 1000)
}

func readProfile(ctx context.Context, tx *sql.Tx, actor, storeID string, lock bool) (MerchantStoreProfile, error) {
	p := MerchantStoreProfile{StoreID: storeID, ActorID: actor}
	query := `SELECT name,description,published,profile_version FROM stores WHERE id=$1 AND owner_actor_id=$2`
	if lock {
		query += " FOR UPDATE"
	}
	err := tx.QueryRowContext(ctx, query, storeID, actor).Scan(&p.Name, &p.Description, &p.Published, &p.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantStoreProfile{}, ErrForbidden
	}
	if err != nil {
		return MerchantStoreProfile{}, ErrStoreOwnerUnavailable
	}
	return p, nil
}

func (s *MerchantStoreRegistrar) ReadStoreProfile(ctx context.Context, token, storeID string) (MerchantStoreProfile, error) {
	actor, err := s.actor(ctx, token)
	if err != nil {
		return MerchantStoreProfile{}, err
	}
	if !registrationPublicID.MatchString(storeID) {
		return MerchantStoreProfile{}, ErrRegistrationInvalid
	}
	if s.grants == nil {
		return MerchantStoreProfile{}, ErrStoreOwnerUnavailable
	}
	tx, err := dbscope.Begin(ctx, s.grants.db, s.grants.schema, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead}, "stores")
	if err != nil {
		return MerchantStoreProfile{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	profile, err := readProfile(ctx, tx, actor, storeID, false)
	if err != nil {
		return MerchantStoreProfile{}, err
	}
	current, err := s.actor(ctx, token)
	if err != nil || current != actor {
		return MerchantStoreProfile{}, ErrUnauthorized
	}
	if err = tx.Commit(); err != nil {
		return MerchantStoreProfile{}, ErrStoreOwnerUnavailable
	}
	return profile, nil
}

func (s *MerchantStoreRegistrar) ChangeStoreProfile(ctx context.Context, token, storeID string, change MerchantStoreProfileChange) (MerchantStoreProfileResult, error) {
	actor, err := s.actor(ctx, token)
	if err != nil {
		return MerchantStoreProfileResult{}, err
	}
	if !registrationPublicID.MatchString(storeID) || !validateProfileChange(change) {
		return MerchantStoreProfileResult{}, ErrRegistrationInvalid
	}
	if s.grants == nil {
		return MerchantStoreProfileResult{}, ErrStoreOwnerUnavailable
	}
	tx, err := dbscope.Begin(ctx, s.grants.db, s.grants.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, "stores", "store_profile_commands")
	if err != nil {
		return MerchantStoreProfileResult{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	// Serialize operation identity across all stores of this actor. The Store
	// row lock also serializes concurrent profile changes/publication.
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(84933,hashtext($1))", actor); err != nil {
		return MerchantStoreProfileResult{}, ErrStoreOwnerUnavailable
	}
	p, err := readProfile(ctx, tx, actor, storeID, true)
	if err != nil {
		return MerchantStoreProfileResult{}, err
	}
	if p.Published {
		return MerchantStoreProfileResult{}, ErrForbidden
	}
	var priorStore, priorName, priorDescription string
	var priorExpected, priorVersion int64
	err = tx.QueryRowContext(ctx, `SELECT store_id,expected_version,result_version,result_name,result_description FROM store_profile_commands WHERE actor_id=$1 AND operation_id=$2`, actor, change.OperationID).Scan(&priorStore, &priorExpected, &priorVersion, &priorName, &priorDescription)
	replay := err == nil
	if replay {
		if priorStore != storeID || priorExpected != change.ExpectedVersion || priorName != change.Name || priorDescription != change.Description {
			return MerchantStoreProfileResult{}, ErrOperationConflict
		}
		p.Name, p.Description, p.Version = priorName, priorDescription, priorVersion
	} else {
		if !errors.Is(err, sql.ErrNoRows) {
			return MerchantStoreProfileResult{}, ErrStoreOwnerUnavailable
		}
		if p.Version != change.ExpectedVersion {
			return MerchantStoreProfileResult{}, ErrStoreProfileVersionConflict
		}
		result, err := tx.ExecContext(ctx, `UPDATE stores SET name=$1,description=$2,profile_version=profile_version+1,updated_at=now() WHERE id=$3 AND owner_actor_id=$4 AND NOT published AND profile_version=$5`, change.Name, change.Description, storeID, actor, p.Version)
		if err != nil {
			return MerchantStoreProfileResult{}, ErrStoreOwnerUnavailable
		}
		n, err := result.RowsAffected()
		if err != nil || n != 1 {
			return MerchantStoreProfileResult{}, ErrStoreProfileVersionConflict
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO store_profile_commands(actor_id,operation_id,store_id,expected_version,result_version,old_name,old_description,result_name,result_description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, actor, change.OperationID, storeID, p.Version, p.Version+1, p.Name, p.Description, change.Name, change.Description); err != nil {
			return MerchantStoreProfileResult{}, ErrStoreOwnerUnavailable
		}
		p.Name, p.Description, p.Version = change.Name, change.Description, p.Version+1
	}
	current, err := s.actor(ctx, token)
	if err != nil || current != actor {
		return MerchantStoreProfileResult{}, ErrUnauthorized
	}
	if err = tx.Commit(); err != nil {
		return MerchantStoreProfileResult{}, ErrUnknownResult
	}
	current, err = s.actor(ctx, token)
	if err != nil || current != actor {
		return MerchantStoreProfileResult{}, ErrUnknownResult
	}
	return MerchantStoreProfileResult{Profile: p, Replay: replay}, nil
}

func NewMerchantStoreProfileHandler(service *MerchantStoreRegistrar) http.Handler {
	mux := http.NewServeMux()
	serve := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !registrationPublicID.MatchString(r.PathValue("storeID")) || r.URL.RawQuery != "" || r.URL.ForceQuery || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeJSON(w, 400, map[string]string{"code": "INVALID_STORE_PROFILE"})
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeFailure(w, ErrUnauthorized)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		if r.Method == http.MethodGet {
			profile, err := service.ReadStoreProfile(ctx, token, r.PathValue("storeID"))
			if err != nil {
				writeFailure(w, err)
				return
			}
			writeJSON(w, 200, profile)
			return
		}
		var input struct {
			OperationID     *string `json:"operationId"`
			ExpectedVersion *int64  `json:"expectedVersion"`
			Name            *string `json:"name"`
			Description     *string `json:"description"`
		}
		if decodeUniqueJSON(w, r, 16*1024, &input) != nil || input.OperationID == nil || input.ExpectedVersion == nil || input.Name == nil || input.Description == nil {
			writeJSON(w, 400, map[string]string{"code": "INVALID_STORE_PROFILE"})
			return
		}
		change := MerchantStoreProfileChange{OperationID: *input.OperationID, ExpectedVersion: *input.ExpectedVersion, Name: *input.Name, Description: *input.Description}
		if !validateProfileChange(change) {
			writeJSON(w, 400, map[string]string{"code": "INVALID_STORE_PROFILE"})
			return
		}
		result, err := service.ChangeStoreProfile(ctx, token, r.PathValue("storeID"), change)
		if errors.Is(err, ErrStoreProfileVersionConflict) {
			writeJSON(w, 409, map[string]string{"code": "STORE_PROFILE_VERSION_CONFLICT"})
			return
		}
		if err != nil {
			writeFailure(w, err)
			return
		}
		writeJSON(w, 200, result)
	}
	mux.HandleFunc("GET /v1/stores/{storeID}/profile", serve)
	mux.HandleFunc("PATCH /v1/stores/{storeID}/profile", serve)
	return mux
}
