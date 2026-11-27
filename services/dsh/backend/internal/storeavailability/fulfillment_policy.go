package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"mime"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
	"github.com/lib/pq"
)

// CityFulfillmentPolicy is the city/relation ceiling, not Store admission,
// actual availability, an accepted financial agreement or a payable quote.
type CityFulfillmentPolicy struct {
	CityID         string     `json:"cityId"`
	Relation       string     `json:"relation"`
	Version        int64      `json:"version"`
	AllowedModes   []string   `json:"allowedModes"`
	ChangedByActor string     `json:"changedByActor,omitempty"`
	Reason         string     `json:"reason,omitempty"`
	UpdatedAt      *time.Time `json:"updatedAt,omitempty"`
}

type cityFulfillmentPolicyOwner interface {
	ReadCityFulfillmentPolicy(context.Context, string, string) (CityFulfillmentPolicy, error)
	ApplyCityFulfillmentPolicy(context.Context, string, string, string, string, int64, []string, string) (CityFulfillmentPolicy, bool, error)
}

func canonicalFulfillmentModes(modes []string) ([]string, bool) {
	if modes == nil || len(modes) > 3 {
		return nil, false
	}
	ordered := make([]string, 0, len(modes))
	for _, mode := range []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"} {
		if slices.Contains(modes, mode) {
			ordered = append(ordered, mode)
		}
	}
	return ordered, len(ordered) == len(modes)
}

// Bind the owner schema once per transaction, then issue only fixed SQL with
// bound values. Do not construct statement fragments or schema-qualified SQL.
func (source *PostgresPolicySource) beginFulfillmentPolicy(ctx context.Context, write bool) (*sql.Tx, error) {
	if source == nil || source.db == nil || !strings.HasPrefix(source.schema, "dsh_test_") {
		return nil, ErrPolicyUnavailable
	}
	options := &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}
	if write {
		options = &sql.TxOptions{Isolation: sql.LevelReadCommitted}
	}
	tx, err := dbscope.Begin(ctx, source.db, source.schema, options, "service_cities", "city_fulfillment_policy_versions")
	if err != nil {
		return nil, ErrPolicyUnavailable
	}
	var database, principal string
	if err := tx.QueryRowContext(ctx, "SELECT current_database(),current_user").Scan(&database, &principal); err != nil || !dbscope.IsCartPrincipal(database, principal) {
		_ = tx.Rollback()
		return nil, ErrPolicyUnavailable
	}
	return tx, nil
}

func scanFulfillmentPolicy(row *sql.Row, city, relation string) (CityFulfillmentPolicy, error) {
	policy := CityFulfillmentPolicy{CityID: city, Relation: relation, AllowedModes: []string{}}
	var recorded time.Time
	if err := row.Scan(&policy.Version, pq.Array(&policy.AllowedModes), &policy.ChangedByActor, &policy.Reason, &recorded); err != nil {
		return CityFulfillmentPolicy{}, err
	}
	modes, valid := canonicalFulfillmentModes(policy.AllowedModes)
	if !valid || !slices.Equal(modes, policy.AllowedModes) || policy.Version < 1 ||
		policy.Version > 9007199254740991 || !identityaccess.ValidActorID(policy.ChangedByActor) || recorded.IsZero() {
		return CityFulfillmentPolicy{}, ErrPolicyUnavailable
	}
	recorded = recorded.UTC()
	policy.UpdatedAt = &recorded
	return policy, nil
}

func currentFulfillmentPolicy(ctx context.Context, tx *sql.Tx, city, relation string) (CityFulfillmentPolicy, error) {
	row := tx.QueryRowContext(ctx, `SELECT version,allowed_modes,acting_actor_id,reason,recorded_at
		FROM city_fulfillment_policy_versions WHERE city_id=$1 AND relation=$2 ORDER BY version DESC LIMIT 1`, city, relation)
	policy, err := scanFulfillmentPolicy(row, city, relation)
	if errors.Is(err, sql.ErrNoRows) {
		return CityFulfillmentPolicy{CityID: city, Relation: relation, AllowedModes: []string{}}, nil
	}
	return policy, err
}

func (source *PostgresPolicySource) ReadCityFulfillmentPolicy(ctx context.Context, city, relation string) (CityFulfillmentPolicy, error) {
	if !cityPolicyIDRule.MatchString(city) || !validRegistrationRelation(relation) {
		return CityFulfillmentPolicy{}, ErrInvalidChange
	}
	tx, err := source.beginFulfillmentPolicy(ctx, false)
	if err != nil {
		return CityFulfillmentPolicy{}, err
	}
	defer tx.Rollback()
	var active bool
	if err := tx.QueryRowContext(ctx, "SELECT active FROM service_cities WHERE id=$1", city).Scan(&active); err != nil || !active {
		return CityFulfillmentPolicy{}, ErrPolicyUnavailable
	}
	policy, err := currentFulfillmentPolicy(ctx, tx, city, relation)
	if err != nil || tx.Commit() != nil {
		return CityFulfillmentPolicy{}, ErrPolicyUnavailable
	}
	return policy, nil
}

// The City lock serializes competing writes. The immutable version is also
// the operation receipt, so retries never need a second table or new key.
func (source *PostgresPolicySource) ApplyCityFulfillmentPolicy(ctx context.Context, actor, city, relation, operation string, expected int64, modes []string, reason string) (CityFulfillmentPolicy, bool, error) {
	normalized, valid := canonicalFulfillmentModes(modes)
	reason = strings.TrimSpace(reason)
	if !valid || !identityaccess.ValidActorID(actor) || !cityPolicyIDRule.MatchString(city) ||
		!validRegistrationRelation(relation) || !operationIDRule.MatchString(operation) ||
		expected < 0 || expected >= 9007199254740991 ||
		!utf8.ValidString(reason) || utf8.RuneCountInString(reason) < 1 ||
		utf8.RuneCountInString(reason) > 300 || strings.ContainsFunc(reason, unicode.IsControl) {
		return CityFulfillmentPolicy{}, false, ErrInvalidChange
	}
	tx, err := source.beginFulfillmentPolicy(ctx, true)
	if err != nil {
		return CityFulfillmentPolicy{}, false, err
	}
	defer tx.Rollback()

	var active bool
	if err := tx.QueryRowContext(ctx, "SELECT active FROM service_cities WHERE id=$1 FOR UPDATE", city).Scan(&active); err != nil || !active {
		return CityFulfillmentPolicy{}, false, ErrPolicyUnavailable
	}
	prior, err := scanFulfillmentPolicy(tx.QueryRowContext(ctx, `SELECT version,allowed_modes,acting_actor_id,reason,recorded_at
		FROM city_fulfillment_policy_versions WHERE city_id=$1 AND relation=$2 AND operation_id=$3`,
		city, relation, operation), city, relation)
	switch {
	case err == nil:
		if prior.Version != expected+1 || prior.ChangedByActor != actor || prior.Reason != reason ||
			!slices.Equal(prior.AllowedModes, normalized) {
			return CityFulfillmentPolicy{}, false, ErrOperationConflict
		}
		if tx.Commit() != nil {
			return CityFulfillmentPolicy{}, false, ErrUnknownResult
		}
		return prior, true, nil
	case !errors.Is(err, sql.ErrNoRows):
		return CityFulfillmentPolicy{}, false, ErrPolicyUnavailable
	}

	current, err := currentFulfillmentPolicy(ctx, tx, city, relation)
	if err != nil {
		return CityFulfillmentPolicy{}, false, ErrPolicyUnavailable
	}
	if current.Version != expected {
		return CityFulfillmentPolicy{}, false, ErrPolicyVersionConflict
	}
	policy, err := scanFulfillmentPolicy(tx.QueryRowContext(ctx, `INSERT INTO city_fulfillment_policy_versions
		(city_id,relation,version,operation_id,allowed_modes,acting_actor_id,reason)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		RETURNING version,allowed_modes,acting_actor_id,reason,recorded_at`,
		city, relation, expected+1, operation, pq.Array(normalized), actor, reason), city, relation)
	if err != nil {
		return CityFulfillmentPolicy{}, false, ErrPolicyUnavailable
	}
	if tx.Commit() != nil {
		return CityFulfillmentPolicy{}, false, ErrUnknownResult
	}
	return policy, false, nil
}

func cityFulfillmentPolicyHandler(identity IdentitySessions, owner cityFulfillmentPolicyOwner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodPatch {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		actor, ok := authorizePolicyOperator(w, r, identity, r.URL.RawQuery == "" && !r.URL.ForceQuery)
		if !ok {
			return
		}
		city, relation := r.PathValue("cityID"), r.PathValue("relation")
		if !validRegistrationRelation(relation) {
			writeFailure(w, ErrInvalidChange)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()

		// Recheck the same current Operator before emitting private data or
		// issuing an owner command after parsing the client request.
		stillAuthorized := func() bool {
			current, ok := authorizeCityPolicyOperator(w, r, identity)
			if !ok {
				return false
			}
			if current != actor {
				writeFailure(w, ErrForbidden)
				return false
			}
			return true
		}
		if r.Method == http.MethodGet {
			if r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
				writeFailure(w, ErrInvalidChange)
				return
			}
			policy, err := owner.ReadCityFulfillmentPolicy(ctx, city, relation)
			if err != nil {
				writeFailure(w, err)
				return
			}
			if stillAuthorized() {
				writeJSON(w, http.StatusOK, policy)
			}
			return
		}

		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" || r.Header.Get("Content-Encoding") != "" {
			writeFailure(w, ErrInvalidChange)
			return
		}
		var input struct {
			OperationID     string    `json:"operationId"`
			ExpectedVersion *int64    `json:"expectedVersion"`
			AllowedModes    *[]string `json:"allowedModes"`
			Reason          string    `json:"reason"`
		}
		if decodeUniqueJSON(w, r, 4096, &input) != nil || input.ExpectedVersion == nil || input.AllowedModes == nil {
			writeFailure(w, ErrInvalidChange)
			return
		}
		if !stillAuthorized() {
			return
		}
		policy, replay, err := owner.ApplyCityFulfillmentPolicy(ctx, actor, city, relation, input.OperationID, *input.ExpectedVersion, *input.AllowedModes, input.Reason)
		if err != nil {
			writeFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Policy CityFulfillmentPolicy `json:"policy"`
			Replay bool                  `json:"replay"`
		}{policy, replay})
	}
}
