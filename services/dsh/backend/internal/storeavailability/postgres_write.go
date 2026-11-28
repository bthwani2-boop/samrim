package storeavailability

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"time"
)

func commandHash(c AuthorizedChange) (string, error) {
	encoded, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
}

// ReplayAuthorized preserves the existing persisted hash format. Historical
// policy/timezone bindings come from the immutable audit and result, never from
// today's mutable settings or caller claims. A missing/corrupt audit fails closed.
func (r *PostgresRepository) ReplayAuthorized(ctx context.Context, c AuthorizedChange) (Snapshot, bool, error) {
	if c.StoreID == "" || c.ActorID == "" || !operationIDRule.MatchString(c.OperationID) ||
		(c.AuthoritySource != "MERCHANT_STORE_GRANT" && c.AuthoritySource != "OPERATOR_OPERATIONS") {
		return Snapshot{}, false, ErrForbidden
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, "stores", "store_operational_commands", "store_operational_audit")
	if err != nil {
		return Snapshot{}, false, err
	}
	defer tx.Rollback()
	var owner string
	err = tx.QueryRowContext(ctx, `SELECT owner_actor_id FROM stores WHERE id=$1 FOR SHARE`, c.StoreID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, false, ErrStoreMissing
	}
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	if c.AuthoritySource == "MERCHANT_STORE_GRANT" && owner != c.ActorID {
		return Snapshot{}, false, ErrForbidden
	}
	var hash string
	var encoded, audited []byte
	var policyVersion sql.NullInt64
	var auditActor, auditAuthority sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT c.request_hash,c.result_snapshot,a.after_snapshot,
		a.policy_version,a.acting_actor_id,a.authority_source
		FROM store_operational_commands c LEFT JOIN store_operational_audit a
		ON a.store_id=c.store_id AND a.operation_id=c.operation_id
		WHERE c.store_id=$1 AND c.operation_id=$2`, c.StoreID, c.OperationID).
		Scan(&hash, &encoded, &audited, &policyVersion, &auditActor, &auditAuthority)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, false, nil
	}
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	var historical Snapshot
	if json.Unmarshal(encoded, &historical) != nil || !bytes.Equal(encoded, audited) ||
		historical.StoreID != c.StoreID || historical.Version < 2 || historical.Timezone == "" ||
		!policyVersion.Valid || policyVersion.Int64 < 1 || !auditActor.Valid || !auditAuthority.Valid ||
		historical.ActingActorID != auditActor.String {
		return Snapshot{}, false, ErrUnknownResult
	}
	if auditActor.String != c.ActorID || auditAuthority.String != c.AuthoritySource ||
		(c.Timezone != "" && c.Timezone != historical.Timezone) {
		return Snapshot{}, false, ErrOperationConflict
	}
	c.Timezone, c.PolicyVersion = historical.Timezone, policyVersion.Int64
	wantHash, err := commandHash(c)
	if err != nil {
		return Snapshot{}, false, err
	}
	if wantHash != hash {
		return Snapshot{}, false, ErrOperationConflict
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, false, ErrUnknownResult
	}
	return historical, true, nil
}

// Apply reconciles a PostgreSQL serialization race or uncertain commit without
// reapplying effects. Only an identically-bound durable operation is replayed;
// a truly stale expected version remains a conflict.
func (r *PostgresRepository) Apply(ctx context.Context, c AuthorizedChange) (Snapshot, bool, error) {
	hash, err := commandHash(c)
	if err != nil {
		return Snapshot{}, false, err
	}
	out, replay, err := r.applyOnce(ctx, c, hash)
	if err == nil {
		return out, replay, nil
	}
	if !errors.Is(err, ErrVersionConflict) && !errors.Is(err, ErrUnknownResult) {
		return Snapshot{}, false, err
	}
	// Reconciliation is another private owner read: a concurrent ownership
	// transfer between rollback and recovery must not expose historical state.
	committed, found, lookupErr := r.ReplayAuthorized(ctx, c)
	if errors.Is(lookupErr, ErrOperationConflict) || errors.Is(lookupErr, ErrForbidden) || errors.Is(lookupErr, ErrStoreMissing) {
		return Snapshot{}, false, lookupErr
	}
	if lookupErr != nil {
		return Snapshot{}, false, ErrUnknownResult
	}
	if found {
		return committed, true, nil
	}
	return Snapshot{}, false, err
}

// requireCurrentStoreAuthority locks both Store and City in the mutation
// transaction. A previously read grant is never sufficient at commit time.
func requireCurrentStoreAuthority(ctx context.Context, tx *sql.Tx, c AuthorizedChange) error {
	if c.AuthoritySource != "MERCHANT_STORE_GRANT" && c.AuthoritySource != "OPERATOR_OPERATIONS" {
		return ErrForbidden
	}
	var currentOwner string
	var authoritativeTimezone sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT s.owner_actor_id, city.timezone_name
		FROM stores s JOIN service_cities city ON city.id=s.city_id
		WHERE s.id=$1 FOR SHARE OF s,city`, c.StoreID).
		Scan(&currentOwner, &authoritativeTimezone)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrStoreMissing
	}
	if err != nil {
		return normalizePgError(err)
	}
	if c.AuthoritySource == "MERCHANT_STORE_GRANT" && currentOwner != c.ActorID {
		return ErrForbidden
	}
	if !authoritativeTimezone.Valid || authoritativeTimezone.String != c.Timezone {
		return ErrInvalidTimezone
	}
	if _, err = loadStoreTimezone(c.Timezone); err != nil {
		return ErrInvalidTimezone
	}
	return nil
}

// requireCurrentStorePolicy validates the locked, owner-authored policy
// without trusting caller-provided pause or preparation bounds.
func requireCurrentStorePolicy(ctx context.Context, tx *sql.Tx, c AuthorizedChange) error {
	var livePolicyVersion int64
	var maxPauseSeconds, maxPreparationMinutes int
	var databaseNow time.Time
	err := tx.QueryRowContext(ctx, `SELECT p.version, p.max_pause_seconds, p.max_preparation_minutes, clock_timestamp()
		FROM stores s
		JOIN service_cities city ON city.id=s.city_id
		JOIN store_operational_limits p ON p.city_id=city.id
		WHERE s.id=$1 AND city.active FOR SHARE OF p`, c.StoreID).
		Scan(&livePolicyVersion, &maxPauseSeconds, &maxPreparationMinutes, &databaseNow)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrPolicyUnavailable
	}
	if err != nil {
		return normalizePgError(err)
	}
	if c.PolicyVersion < 1 || livePolicyVersion < 1 || maxPauseSeconds < 0 ||
		maxPauseSeconds > 31536000 || maxPreparationMinutes < 0 || maxPreparationMinutes > 1440 {
		return ErrPolicyUnavailable
	}
	if livePolicyVersion != c.PolicyVersion {
		return ErrPolicyVersionConflict
	}
	if c.PreparationMinutes < 0 || c.PreparationMinutes > maxPreparationMinutes {
		return ErrInvalidChange
	}
	if c.PausedUntil != nil {
		pauseFor := c.PausedUntil.Sub(databaseNow)
		if maxPauseSeconds == 0 || pauseFor <= 0 || pauseFor > time.Duration(maxPauseSeconds)*time.Second {
			return ErrInvalidChange
		}
	}
	return nil
}

func (r *PostgresRepository) applyOnce(ctx context.Context, c AuthorizedChange, hash string) (Snapshot, bool, error) {
	if c.StoreID == "" || c.ActorID == "" || !operationIDRule.MatchString(c.OperationID) {
		return Snapshot{}, false, ErrInvalidChange
	}
	if err := ValidateSchedule(c.Weekly); err != nil {
		return Snapshot{}, false, err
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelSerializable}, "stores", "service_cities", "store_operational_limits", "store_operational_availability", "store_operational_weekly_hours", "store_operational_commands", "store_operational_audit")
	if err != nil {
		return Snapshot{}, false, err
	}
	defer tx.Rollback()
	// Lock canonical Store/City authority in the same serializable transaction;
	// a concurrent ownership transfer or timezone change must fail closed.
	if err = requireCurrentStoreAuthority(ctx, tx, c); err != nil {
		return Snapshot{}, false, err
	}
	// A first Store update creates an explicitly closed schedule record,
	// inside the same transaction as the first authorized operation.
	_, err = tx.ExecContext(ctx, `INSERT INTO store_operational_availability
		(store_id,store_timezone,changed_by_actor,change_reason)
		VALUES ($1,$2,$3,$4) ON CONFLICT (store_id) DO NOTHING`,
		c.StoreID, c.Timezone, c.ActorID, "Initial Store availability configuration")
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	// Stable operation ID is looked up BEFORE expected-version checking:
	// an ambiguous commit can safely be reconciled as an idempotent replay.
	var storedHash string
	var storedJSON []byte
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result_snapshot
		FROM store_operational_commands WHERE store_id=$1 AND operation_id=$2`,
		c.StoreID, c.OperationID).Scan(&storedHash, &storedJSON)
	if err == nil {
		if storedHash != hash {
			return Snapshot{}, false, ErrOperationConflict
		}
		var previous Snapshot
		if err = json.Unmarshal(storedJSON, &previous); err != nil {
			return Snapshot{}, false, err
		}
		if err = tx.Commit(); err != nil {
			return Snapshot{}, false, ErrUnknownResult
		}
		return previous, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, false, normalizePgError(err)
	}
	before, err := r.readSnapshot(ctx, tx, c.StoreID, snapshotExclusiveLock)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	if before.Version != c.ExpectedVersion {
		return Snapshot{}, false, ErrVersionConflict
	}
	// Hold the DSH policy lock through commit, so policy edits cannot make
	// an authorized Store change retroactively valid or invalid.
	if err = requireCurrentStorePolicy(ctx, tx, c); err != nil {
		return Snapshot{}, false, err
	}
	after := Snapshot{
		StoreID: c.StoreID, Timezone: c.Timezone, Weekly: append([]WeeklyWindow{}, c.Weekly...),
		PausedUntil: c.PausedUntil, PreparationMinutes: c.PreparationMinutes,
		Version: before.Version + 1, ActingActorID: c.ActorID, Reason: c.Reason,
	}
	_, err = tx.ExecContext(ctx, `UPDATE store_operational_availability SET
		store_timezone=$2,paused_until=$3,preparation_minutes=$4,version=$5,
		changed_by_actor=$6,change_reason=$7,updated_at=now()
		WHERE store_id=$1`, c.StoreID, c.Timezone, c.PausedUntil,
		c.PreparationMinutes, after.Version, c.ActorID, c.Reason)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	_, err = tx.ExecContext(ctx, "DELETE FROM store_operational_weekly_hours WHERE store_id=$1", c.StoreID)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	for _, window := range after.Weekly {
		_, err = tx.ExecContext(ctx, `INSERT INTO store_operational_weekly_hours
			(store_id,weekday,opens_minute,closes_minute) VALUES($1,$2,$3,$4)`,
			c.StoreID, int(window.Weekday), window.Opens, window.Closes)
		if err != nil {
			return Snapshot{}, false, normalizePgError(err)
		}
	}
	beforeJSON, err := json.Marshal(before)
	if err != nil {
		return Snapshot{}, false, err
	}
	afterJSON, err := json.Marshal(after)
	if err != nil {
		return Snapshot{}, false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO store_operational_commands
		(store_id,operation_id,request_hash,resulting_version,result_snapshot)
		VALUES ($1,$2,$3,$4,$5)`,
		c.StoreID, c.OperationID, hash, after.Version, afterJSON)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO store_operational_audit
		(store_id,operation_id,acting_actor_id,authority_source,reason,before_snapshot,after_snapshot,policy_version)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		c.StoreID, c.OperationID, c.ActorID, c.AuthoritySource, c.Reason, beforeJSON, afterJSON, c.PolicyVersion)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, false, ErrUnknownResult
	}
	return after, false, nil
}
