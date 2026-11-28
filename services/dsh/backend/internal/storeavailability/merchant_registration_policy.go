package storeavailability

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

// DSH is the single authority for the admission policy governing all Store
// creations, whether the Merchant is joining for the first or a later Store.
type StoreRegistrationPolicy struct {
	CityID         string     `json:"cityId"`
	Relation       string     `json:"relation"`
	Version        int64      `json:"version"`
	Enabled        bool       `json:"enabled"`
	TermsVersion   string     `json:"termsVersion,omitempty"`
	TermsText      string     `json:"termsText,omitempty"`
	ChangedByActor string     `json:"changedByActor,omitempty"`
	ChangeReason   string     `json:"changeReason,omitempty"`
	UpdatedAt      *time.Time `json:"updatedAt,omitempty"`
}
type StoreRegistrationPolicyChange struct {
	CityID          string `json:"-"`
	Relation        string `json:"-"`
	OperationID     string `json:"operationId"`
	ExpectedVersion int64  `json:"expectedVersion"`
	Enabled         bool   `json:"enabled"`
	TermsVersion    string `json:"termsVersion"`
	TermsText       string `json:"termsText"`
	Reason          string `json:"reason"`
}
type StoreRegistrationPolicyResult struct {
	Policy StoreRegistrationPolicy `json:"policy"`
	Replay bool                    `json:"replay"`
}

func validRegistrationRelation(relation string) bool {
	return relation == "MARKETPLACE" || relation == "DIRECT"
}
func validStoreRegistrationPolicyChange(change StoreRegistrationPolicyChange) bool {
	reason := strings.TrimSpace(change.Reason)
	text := strings.TrimSpace(change.TermsText)
	return registrationPublicID.MatchString(change.CityID) && validRegistrationRelation(change.Relation) &&
		operationIDRule.MatchString(change.OperationID) && change.ExpectedVersion >= 0 &&
		change.ExpectedVersion < math.MaxInt64 &&
		termsVersionRule.MatchString(change.TermsVersion) &&
		utf8.ValidString(change.TermsText) && len([]rune(text)) >= 1 && len([]rune(text)) <= 4000 &&
		!strings.ContainsRune(change.TermsText, 0) &&
		utf8.ValidString(reason) && len([]rune(reason)) >= 1 && len([]rune(reason)) <= 300 &&
		!strings.ContainsFunc(reason, unicode.IsControl)
}
func (s *MerchantStoreRegistrar) ReadRegistrationPolicy(
	ctx context.Context, cityID, relation string,
) (StoreRegistrationPolicy, error) {
	if !registrationPublicID.MatchString(cityID) || !validRegistrationRelation(relation) {
		return StoreRegistrationPolicy{}, ErrRegistrationInvalid
	}
	tx, err := dbscope.Begin(ctx, s.grants.db, s.grants.schema, &sql.TxOptions{
		ReadOnly: true, Isolation: sql.LevelRepeatableRead,
	}, "store_registration_policies", "store_registration_terms")
	if err != nil {
		return StoreRegistrationPolicy{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	policy := StoreRegistrationPolicy{CityID: cityID, Relation: relation}
	var changedAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT p.version,p.enabled,p.terms_version,t.body,
            p.changed_by_actor,p.change_reason,p.updated_at
        FROM store_registration_policies p
        JOIN store_registration_terms t ON t.version=p.terms_version
        WHERE p.city_id=$1 AND p.relation=$2`, cityID, relation).
		Scan(&policy.Version, &policy.Enabled, &policy.TermsVersion, &policy.TermsText,
			&policy.ChangedByActor, &policy.ChangeReason, &changedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return StoreRegistrationPolicy{}, ErrStoreOwnerUnavailable
	}
	if err == nil {
		changedAt = changedAt.UTC()
		policy.UpdatedAt = &changedAt
	}
	if err = tx.Commit(); err != nil {
		return StoreRegistrationPolicy{}, ErrStoreOwnerUnavailable
	}
	return policy, nil
}

// ApplyRegistrationPolicy keeps one versioned DSH admission truth and an
// immutable operation result. The same SQL transaction gates new Merchant
// Store creation via the policy row lock taken in Register.
func (s *MerchantStoreRegistrar) ApplyRegistrationPolicy(
	ctx context.Context, actorID string, change StoreRegistrationPolicyChange,
) (StoreRegistrationPolicyResult, error) {
	if !identityaccess.ValidActorID(actorID) || !validStoreRegistrationPolicyChange(change) {
		return StoreRegistrationPolicyResult{}, ErrRegistrationInvalid
	}
	tx, err := dbscope.Begin(ctx, s.grants.db, s.grants.schema, &sql.TxOptions{
		Isolation: sql.LevelReadCommitted,
	}, "store_registration_policy_commands", "store_registration_terms", "service_cities", "store_registration_policies")
	if err != nil {
		return StoreRegistrationPolicyResult{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	result, err := applyRegistrationPolicyTx(ctx, tx, actorID, change)
	if err != nil {
		return StoreRegistrationPolicyResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return StoreRegistrationPolicyResult{}, ErrUnknownResult
	}
	return result, nil
}

// The owner transaction primitive is shared by normal Operator decisions and
// the explicitly authorized fresh-only synthetic bootstrap.
func applyRegistrationPolicyTx(ctx context.Context, tx *sql.Tx, actorID string, change StoreRegistrationPolicyChange) (StoreRegistrationPolicyResult, error) {
	if !identityaccess.ValidActorID(actorID) || !validStoreRegistrationPolicyChange(change) {
		return StoreRegistrationPolicyResult{}, ErrRegistrationInvalid
	}
	change.Reason = strings.TrimSpace(change.Reason)
	change.TermsText = strings.TrimSpace(change.TermsText)
	// City and relation are URL-bound, not JSON request fields. They must still
	// participate in the idempotency fingerprint to prevent cross-Store-policy replay.
	encoded, err := json.Marshal(struct {
		CityID   string                        `json:"cityId"`
		Relation string                        `json:"relation"`
		Change   StoreRegistrationPolicyChange `json:"change"`
	}{CityID: change.CityID, Relation: change.Relation, Change: change})
	if err != nil {
		return StoreRegistrationPolicyResult{}, ErrRegistrationInvalid
	}
	digest := sha256.Sum256(encoded)
	fingerprint := hex.EncodeToString(digest[:])
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(84926,hashtext($1))",
		change.CityID+":"+change.Relation); err != nil {
		return StoreRegistrationPolicyResult{}, ErrStoreOwnerUnavailable
	}
	var savedHash string
	policy := StoreRegistrationPolicy{}
	var timestamp time.Time
	err = tx.QueryRowContext(ctx, `SELECT c.request_hash,c.city_id,c.relation,c.result_version,c.enabled,
        c.terms_version,t.body,c.actor_id,c.change_reason,c.applied_at
        FROM store_registration_policy_commands c
        JOIN store_registration_terms t ON t.version=c.terms_version
        WHERE c.actor_id=$1 AND c.operation_id=$2`, actorID, change.OperationID).
		Scan(&savedHash, &policy.CityID, &policy.Relation, &policy.Version, &policy.Enabled,
			&policy.TermsVersion, &policy.TermsText, &policy.ChangedByActor, &policy.ChangeReason, &timestamp)
	if err == nil {
		if savedHash != fingerprint {
			return StoreRegistrationPolicyResult{}, ErrOperationConflict
		}
		timestamp = timestamp.UTC()
		policy.UpdatedAt = &timestamp
		return StoreRegistrationPolicyResult{Policy: policy, Replay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreRegistrationPolicyResult{}, ErrStoreOwnerUnavailable
	}
	var active bool
	err = tx.QueryRowContext(ctx, "SELECT active FROM service_cities WHERE id=$1 FOR SHARE", change.CityID).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreRegistrationPolicyResult{}, ErrRegistrationInvalid
	}
	if err != nil {
		return StoreRegistrationPolicyResult{}, ErrStoreOwnerUnavailable
	}
	if !active {
		return StoreRegistrationPolicyResult{}, ErrRegistrationClosed
	}
	var currentVersion int64
	err = tx.QueryRowContext(ctx, `SELECT version FROM store_registration_policies
        WHERE city_id=$1 AND relation=$2 FOR UPDATE`, change.CityID, change.Relation).Scan(&currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return StoreRegistrationPolicyResult{}, ErrStoreOwnerUnavailable
	}
	if currentVersion != change.ExpectedVersion {
		return StoreRegistrationPolicyResult{}, ErrPolicyVersionConflict
	}
	var recordedText string
	err = tx.QueryRowContext(ctx, "SELECT body FROM store_registration_terms WHERE version=$1 FOR SHARE",
		change.TermsVersion).Scan(&recordedText)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = tx.ExecContext(ctx, `INSERT INTO store_registration_terms(version,body)
            VALUES($1,$2) ON CONFLICT (version) DO NOTHING`, change.TermsVersion, change.TermsText)
		if err != nil {
			return StoreRegistrationPolicyResult{}, ErrUnknownResult
		}
		err = tx.QueryRowContext(ctx, "SELECT body FROM store_registration_terms WHERE version=$1",
			change.TermsVersion).Scan(&recordedText)
	}
	if err != nil {
		return StoreRegistrationPolicyResult{}, ErrStoreOwnerUnavailable
	}
	if recordedText != change.TermsText {
		return StoreRegistrationPolicyResult{}, ErrRegistrationPolicyChanged
	}
	resultVersion := currentVersion + 1
	if currentVersion == 0 {
		_, err = tx.ExecContext(ctx, `INSERT INTO store_registration_policies
            (city_id,relation,version,enabled,terms_version,changed_by_actor,change_reason)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,
			change.CityID, change.Relation, resultVersion, change.Enabled, change.TermsVersion, actorID, change.Reason)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE store_registration_policies SET version=$3,enabled=$4,
            terms_version=$5,changed_by_actor=$6,change_reason=$7,updated_at=now()
            WHERE city_id=$1 AND relation=$2`,
			change.CityID, change.Relation, resultVersion, change.Enabled, change.TermsVersion, actorID, change.Reason)
	}
	if err != nil {
		return StoreRegistrationPolicyResult{}, ErrUnknownResult
	}
	var appliedAt time.Time
	err = tx.QueryRowContext(ctx, `INSERT INTO store_registration_policy_commands
        (actor_id,operation_id,request_hash,city_id,relation,result_version,enabled,terms_version,change_reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING applied_at`,
		actorID, change.OperationID, fingerprint, change.CityID, change.Relation, resultVersion,
		change.Enabled, change.TermsVersion, change.Reason).Scan(&appliedAt)
	if err != nil {
		return StoreRegistrationPolicyResult{}, ErrUnknownResult
	}
	appliedAt = appliedAt.UTC()
	policy = StoreRegistrationPolicy{
		CityID: change.CityID, Relation: change.Relation, Version: resultVersion,
		Enabled: change.Enabled, TermsVersion: change.TermsVersion, TermsText: change.TermsText,
		ChangedByActor: actorID, ChangeReason: change.Reason, UpdatedAt: &appliedAt,
	}
	return StoreRegistrationPolicyResult{Policy: policy}, nil
}

func NewStoreRegistrationPolicyHandler(s *MerchantStoreRegistrar) (http.Handler, error) {
	if s == nil || s.identity == nil || s.grants == nil {
		return nil, ErrStoreOwnerUnavailable
	}
	mux := http.NewServeMux()
	const path = "/v1/operators/cities/{cityID}/store-registration-policy/{relation}"
	handle := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !validRegistrationRelation(r.PathValue("relation")) {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		actor, ok := authorizeCityPolicyOperator(w, r, s.identity)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			policy, err := s.ReadRegistrationPolicy(r.Context(), r.PathValue("cityID"), r.PathValue("relation"))
			if err != nil {
				writeRegistrationFailure(w, err)
				return
			}
			writeJSON(w, http.StatusOK, policy)
			return
		}
		if r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeFailure(w, ErrForbidden)
			return
		}
		// Match the bounded Web adapter; 4,000 UTF-8 terms characters may exceed 8 KiB.
		var input StoreRegistrationPolicyChange
		if decodeUniqueJSON(w, r, 24576, &input) != nil {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		input.CityID = r.PathValue("cityID")
		input.Relation = r.PathValue("relation")
		result, err := s.ApplyRegistrationPolicy(r.Context(), actor, input)
		if err != nil {
			if errors.Is(err, ErrRegistrationInvalid) {
				writeRegistrationFailure(w, err)
				return
			}
			if errors.Is(err, ErrRegistrationPolicyChanged) {
				writeRegistrationFailure(w, err)
				return
			}
			writeFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
	mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, PATCH")
			w.WriteHeader(405)
			return
		}
		handle(w, r)
	})
	mux.HandleFunc("PATCH "+path, handle)
	mux.HandleFunc("GET "+path+"/history", storeRegistrationPolicyHistoryHandler(s))
	return mux, nil
}
