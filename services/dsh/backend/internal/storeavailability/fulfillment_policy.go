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

// CityFulfillmentPolicy is a ceiling on permissible modes, not Store-specific
// admission, current availability, a WLT agreement or a payable quote.
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
	result := make([]string, 0, len(modes))
	for _, candidate := range []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"} {
		if slices.Contains(modes, candidate) {
			result = append(result, candidate)
		}
	}
	return result, len(result) == len(modes)
}

func (source *PostgresPolicySource) beginFulfillmentPolicy(ctx context.Context, write bool) (*sql.Tx, error) {
	if source == nil || source.db == nil || !strings.HasPrefix(source.schema, "dsh_test_") {
		return nil, ErrPolicyUnavailable
	}
	level := sql.LevelRepeatableRead
	if write {
		level = sql.LevelReadCommitted
	}
	tx, err := dbscope.Begin(ctx, source.db, source.schema, &sql.TxOptions{Isolation: level, ReadOnly: !write}, "service_cities", "city_fulfillment_policy_versions")
	if err != nil {
		return nil, ErrPolicyUnavailable
	}
	var db, role string
	if err = tx.QueryRowContext(ctx, "SELECT current_database(),current_user").Scan(&db, &role); err != nil || !dbscope.IsCartPrincipal(db, role) {
		_ = tx.Rollback()
		return nil, ErrPolicyUnavailable
	}
	return tx, nil
}

const fulfillmentPolicyColumns = "version,allowed_modes,acting_actor_id,reason,recorded_at"

func scanFulfillmentPolicy(row *sql.Row, city, relation string) (CityFulfillmentPolicy, error) {
	p := CityFulfillmentPolicy{CityID: city, Relation: relation, AllowedModes: []string{}}
	var recorded time.Time
	err := row.Scan(&p.Version, pq.Array(&p.AllowedModes), &p.ChangedByActor, &p.Reason, &recorded)
	if err != nil {
		return CityFulfillmentPolicy{}, err
	}
	normalized, ok := canonicalFulfillmentModes(p.AllowedModes)
	if !ok || !slices.Equal(normalized, p.AllowedModes) || p.Version < 1 || p.Version > 9007199254740991 || !identityaccess.ValidActorID(p.ChangedByActor) || recorded.IsZero() {
		return CityFulfillmentPolicy{}, ErrPolicyUnavailable
	}
	recorded = recorded.UTC()
	p.UpdatedAt = &recorded
	return p, nil
}

func currentFulfillmentPolicy(ctx context.Context, tx *sql.Tx, city, relation string) (CityFulfillmentPolicy, error) {
	p, err := scanFulfillmentPolicy(tx.QueryRowContext(ctx, "SELECT "+fulfillmentPolicyColumns+" FROM city_fulfillment_policy_versions WHERE city_id=$1 AND relation=$2 ORDER BY version DESC LIMIT 1", city, relation), city, relation)
	if errors.Is(err, sql.ErrNoRows) {
		return CityFulfillmentPolicy{CityID: city, Relation: relation, AllowedModes: []string{}}, nil
	}
	return p, err
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
	if err = tx.QueryRowContext(ctx, "SELECT active FROM service_cities WHERE id=$1", city).Scan(&active); err != nil || !active {
		return CityFulfillmentPolicy{}, ErrPolicyUnavailable
	}
	p, err := currentFulfillmentPolicy(ctx, tx, city, relation)
	if err != nil || tx.Commit() != nil {
		return CityFulfillmentPolicy{}, ErrPolicyUnavailable
	}
	return p, nil
}

// Lock the canonical City before reading version or replay. The immutable
// version row is also the operation receipt; there is no duplicate current
// policy table, default or separate command ledger. Retry an ambiguous commit
// with the identical operation; no new key may be invented by the server.
func (source *PostgresPolicySource) ApplyCityFulfillmentPolicy(ctx context.Context, actor, city, relation, operation string, expected int64, modes []string, reason string) (CityFulfillmentPolicy, bool, error) {
	normalized, valid := canonicalFulfillmentModes(modes)
	reason = strings.TrimSpace(reason)
	if !valid || !identityaccess.ValidActorID(actor) || !cityPolicyIDRule.MatchString(city) || !validRegistrationRelation(relation) ||
		!operationIDRule.MatchString(operation) || expected < 0 || expected >= 9007199254740991 ||
		!utf8.ValidString(reason) || utf8.RuneCountInString(reason) < 1 || utf8.RuneCountInString(reason) > 300 || strings.ContainsFunc(reason, unicode.IsControl) {
		return CityFulfillmentPolicy{}, false, ErrInvalidChange
	}
	tx, err := source.beginFulfillmentPolicy(ctx, true)
	if err != nil {
		return CityFulfillmentPolicy{}, false, err
	}
	defer tx.Rollback()
	var active bool
	if err = tx.QueryRowContext(ctx, "SELECT active FROM service_cities WHERE id=$1 FOR UPDATE", city).Scan(&active); err != nil || !active {
		return CityFulfillmentPolicy{}, false, ErrPolicyUnavailable
	}
	prior, err := scanFulfillmentPolicy(tx.QueryRowContext(ctx, "SELECT "+fulfillmentPolicyColumns+" FROM city_fulfillment_policy_versions WHERE city_id=$1 AND relation=$2 AND operation_id=$3", city, relation, operation), city, relation)
	if err == nil {
		if prior.Version != expected+1 || prior.ChangedByActor != actor || prior.Reason != reason || !slices.Equal(prior.AllowedModes, normalized) {
			return CityFulfillmentPolicy{}, false, ErrOperationConflict
		}
		if tx.Commit() != nil {
			return CityFulfillmentPolicy{}, false, ErrUnknownResult
		}
		return prior, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CityFulfillmentPolicy{}, false, ErrPolicyUnavailable
	}
	current, err := currentFulfillmentPolicy(ctx, tx, city, relation)
	if err != nil {
		return CityFulfillmentPolicy{}, false, ErrPolicyUnavailable
	}
	if current.Version != expected {
		return CityFulfillmentPolicy{}, false, ErrPolicyVersionConflict
	}
	p, err := scanFulfillmentPolicy(tx.QueryRowContext(ctx, `INSERT INTO city_fulfillment_policy_versions(city_id,relation,version,operation_id,allowed_modes,acting_actor_id,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING `+fulfillmentPolicyColumns, city, relation, expected+1, operation, pq.Array(normalized), actor, reason), city, relation)
	if err != nil {
		return CityFulfillmentPolicy{}, false, ErrPolicyUnavailable
	}
	if tx.Commit() != nil {
		return CityFulfillmentPolicy{}, false, ErrUnknownResult
	}
	return p, false, nil
}

func cityFulfillmentPolicyHandler(identity IdentitySessions, owner cityFulfillmentPolicyOwner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodPatch {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		city, relation := r.PathValue("cityID"), r.PathValue("relation")
		actor, ok := authorizePolicyOperator(w, r, identity, r.URL.RawQuery == "" && !r.URL.ForceQuery)
		if !ok {
			return
		}
		if !validRegistrationRelation(relation) {
			writeFailure(w, ErrInvalidChange)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		if r.Method == http.MethodGet {
			if r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
				writeFailure(w, ErrInvalidChange)
				return
			}
			p, err := owner.ReadCityFulfillmentPolicy(ctx, city, relation)
			if err != nil {
				writeFailure(w, err)
				return
			}
			current, ok := authorizeCityPolicyOperator(w, r, identity)
			if !ok {
				return
			}
			if current != actor {
				writeFailure(w, ErrForbidden)
				return
			}
			writeJSON(w, http.StatusOK, p)
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
		current, ok := authorizeCityPolicyOperator(w, r, identity)
		if !ok {
			return
		}
		if current != actor {
			writeFailure(w, ErrForbidden)
			return
		}
		p, replay, err := owner.ApplyCityFulfillmentPolicy(ctx, actor, city, relation, input.OperationID, *input.ExpectedVersion, *input.AllowedModes, input.Reason)
		if err != nil {
			writeFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Policy CityFulfillmentPolicy `json:"policy"`
			Replay bool                  `json:"replay"`
		}{p, replay})
	}
}
