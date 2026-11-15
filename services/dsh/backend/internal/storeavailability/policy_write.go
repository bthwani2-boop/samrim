package storeavailability

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

// CityPolicyChange represents a complete, deliberate city-policy replacement.
// ExpectedVersion=0 is permitted only for initial provisioning. Absent policy
// never defaults to open/allowed, and no change can alter an accepted Order.
type CityPolicyChange struct {
	CityID                string
	OperationID           string
	ExpectedVersion       int64
	MaxPauseSeconds       int
	MaxPreparationMinutes int
	Reason                string
}

type CityPolicyWriter interface {
	ApplyCityPolicy(context.Context, string, CityPolicyChange) (CityPolicy, bool, error)
}

func validCityPolicyChange(change CityPolicyChange) bool {
	return cityPolicyIDRule.MatchString(change.CityID) &&
		operationIDRule.MatchString(change.OperationID) && change.ExpectedVersion >= 0 &&
		change.MaxPauseSeconds >= 0 && change.MaxPauseSeconds <= 31536000 &&
		change.MaxPreparationMinutes >= 0 && change.MaxPreparationMinutes <= 1440 &&
		utf8.ValidString(change.Reason) && utf8.RuneCountInString(strings.TrimSpace(change.Reason)) >= 1 &&
		utf8.RuneCountInString(change.Reason) <= 300
}

func policyCommandHash(actorID string, change CityPolicyChange) (string, error) {
	data, err := json.Marshal(struct {
		ActorID string
		CityPolicyChange
	}{ActorID: actorID, CityPolicyChange: change})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// ApplyCityPolicy is the sole DSH policy writer. Its caller must have verified
// the SAME current Operator bearer and Identity platform_policies permission.
// City row locking serializes competing commands, and 004's version/audit
// triggers protect the durable history at the persistence boundary.
func (source *PostgresPolicySource) ApplyCityPolicy(
	ctx context.Context, actorID string, change CityPolicyChange,
) (CityPolicy, bool, error) {
	if source == nil || source.db == nil {
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	if !validCityPolicyChange(change) || !utf8.ValidString(actorID) ||
		len(actorID) > 128 || strings.TrimSpace(actorID) != actorID || actorID == "" {
		return CityPolicy{}, false, ErrInvalidChange
	}
	change.Reason = strings.TrimSpace(change.Reason)
	hash, err := policyCommandHash(actorID, change)
	if err != nil {
		return CityPolicy{}, false, ErrInvalidChange
	}
	policy, replay, err := source.applyCityPolicyOnce(ctx, actorID, change, hash)
	if !errors.Is(err, ErrUnknownResult) {
		return policy, replay, err
	}
	// A COMMIT response may be lost after PostgreSQL durably writes the policy.
	// Reconcile only the SAME actor/payload/key with the immutable command log.
	confirmed, found, lookupErr := source.committedCityPolicy(ctx, change.CityID, change.OperationID, hash)
	if errors.Is(lookupErr, ErrOperationConflict) {
		return CityPolicy{}, false, ErrOperationConflict
	}
	if lookupErr == nil && found {
		return confirmed, true, nil
	}
	return CityPolicy{}, false, ErrUnknownResult
}

func scanCityPolicyRow(row *sql.Row) (CityPolicy, error) {
	var policy CityPolicy
	err := row.Scan(&policy.CityID, &policy.Version, &policy.MaxPauseSeconds,
		&policy.MaxPreparationMinutes, &policy.ChangedByActor, &policy.ChangeReason,
		&policy.UpdatedAt)
	return policy, err
}

func readCommittedPolicy(ctx context.Context, tx *sql.Tx, cityID, operationID, hash string) (CityPolicy, bool, error) {
	var storedHash string
	var appliedVersion int64
	err := tx.QueryRowContext(ctx, `SELECT request_hash,resulting_version
		FROM store_operational_policy_commands WHERE city_id=$1 AND operation_id=$2`,
		cityID, operationID).Scan(&storedHash, &appliedVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return CityPolicy{}, false, nil
	}
	if err != nil {
		return CityPolicy{}, false, err
	}
	if hash != storedHash {
		return CityPolicy{}, false, ErrOperationConflict
	}
	policy, err := scanCityPolicyRow(tx.QueryRowContext(ctx, `SELECT city_id,version,max_pause_seconds,
		max_preparation_minutes,acting_actor_id,reason,changed_at
		FROM store_operational_limits_audit WHERE city_id=$1 AND version=$2`,
		cityID, appliedVersion))
	if err != nil {
		return CityPolicy{}, false, err
	}
	return policy, true, nil
}

func (source *PostgresPolicySource) committedCityPolicy(
	ctx context.Context, cityID, operationID, hash string,
) (CityPolicy, bool, error) {
	tx, err := beginScopedStoreTx(ctx, source.db, source.schema, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return CityPolicy{}, false, err
	}
	defer tx.Rollback()
	policy, found, err := readCommittedPolicy(ctx, tx, cityID, operationID, hash)
	if err != nil {
		return CityPolicy{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CityPolicy{}, false, err
	}
	return policy, found, nil
}

func (source *PostgresPolicySource) applyCityPolicyOnce(
	ctx context.Context, actorID string, change CityPolicyChange, hash string,
) (CityPolicy, bool, error) {
	tx, err := beginScopedStoreTx(ctx, source.db, source.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	defer tx.Rollback()

	// Check live city eligibility and lock its canonical row throughout the
	// command, not in a preflight request susceptible to a concurrent change.
	var active bool
	err = tx.QueryRowContext(ctx, `SELECT active FROM service_cities WHERE id=$1 FOR UPDATE`,
		change.CityID).Scan(&active)
	if errors.Is(err, sql.ErrNoRows) || !active {
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	if err != nil {
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	prior, found, err := readCommittedPolicy(ctx, tx, change.CityID, change.OperationID, hash)
	if err != nil {
		if errors.Is(err, ErrOperationConflict) {
			return CityPolicy{}, false, ErrOperationConflict
		}
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	if found {
		if err = tx.Commit(); err != nil {
			return CityPolicy{}, false, ErrUnknownResult
		}
		return prior, true, nil
	}

	var version int64
	err = tx.QueryRowContext(ctx, `SELECT version FROM store_operational_limits
		WHERE city_id=$1 FOR UPDATE`, change.CityID).Scan(&version)
	if !errors.Is(err, sql.ErrNoRows) && err != nil {
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	if errors.Is(err, sql.ErrNoRows) {
		version = 0
	}
	if version != change.ExpectedVersion {
		return CityPolicy{}, false, ErrPolicyVersionConflict
	}
	if version == 0 {
		_, err = tx.ExecContext(ctx, `INSERT INTO store_operational_limits
			(city_id,max_pause_seconds,max_preparation_minutes,version,changed_by_actor,change_reason)
			VALUES ($1,$2,$3,1,$4,$5)`, change.CityID,
			change.MaxPauseSeconds, change.MaxPreparationMinutes, actorID, change.Reason)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE store_operational_limits SET
			max_pause_seconds=$2,max_preparation_minutes=$3,version=version+1,
			changed_by_actor=$4,change_reason=$5 WHERE city_id=$1`,
			change.CityID, change.MaxPauseSeconds, change.MaxPreparationMinutes, actorID, change.Reason)
	}
	if err != nil {
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	current, err := scanCityPolicyRow(tx.QueryRowContext(ctx, `SELECT city_id,version,max_pause_seconds,
		max_preparation_minutes,changed_by_actor,change_reason,updated_at
		FROM store_operational_limits WHERE city_id=$1`, change.CityID))
	if err != nil || current.Version != version+1 {
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	// 004's audit trigger executes in this transaction, before the immutable
	// command references that audit row. Rollback removes both if either fails.
	_, err = tx.ExecContext(ctx, `INSERT INTO store_operational_policy_commands
		(city_id,operation_id,request_hash,acting_actor_id,resulting_version)
		VALUES ($1,$2,$3,$4,$5)`, change.CityID, change.OperationID, hash, actorID, current.Version)
	if err != nil {
		return CityPolicy{}, false, ErrPolicyUnavailable
	}
	if err = tx.Commit(); err != nil {
		return CityPolicy{}, false, ErrUnknownResult
	}
	return current, false, nil
}
