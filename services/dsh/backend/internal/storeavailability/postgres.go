package storeavailability

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/lib/pq"
)

// PostgresRepository writes operational facts in the SAME DSH Store schema.
// It never persists the derived orderability enum and never modifies WLT.
type PostgresRepository struct {
	db     *sql.DB
	schema string
}

var postgresSchemaRule = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

// beginScopedStoreTx binds every Store query to a single validated DSH schema,
// without constructing executable SQL from a schema identifier. SET LOCAL is
// transaction-scoped, so a pooled connection never retains Store access to a
// previous caller's schema. Explicit pg_catalog and pg_temp order also blocks
// temporary-table shadowing of canonical Store relations.
func beginScopedStoreTx(ctx context.Context, db *sql.DB, schema string, options *sql.TxOptions) (*sql.Tx, error) {
	if db == nil || !postgresSchemaRule.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	tx, err := db.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx,
		"SELECT pg_catalog.set_config('search_path', 'pg_catalog,' || pg_catalog.quote_ident($1) || ',pg_temp', true)", schema)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func NewPostgresRepository(db *sql.DB, schema string) (*PostgresRepository, error) {
	if db == nil || !postgresSchemaRule.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	return &PostgresRepository{db: db, schema: schema}, nil
}

func (r *PostgresRepository) Read(ctx context.Context, storeID string) (Snapshot, error) {
	if strings.TrimSpace(storeID) == "" {
		return Snapshot{}, ErrStoreMissing
	}
	tx, err := beginScopedStoreTx(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	if err = r.ensureStore(ctx, tx, storeID); err != nil {
		return Snapshot{}, err
	}
	snapshot, err := r.readSnapshot(ctx, tx, storeID, snapshotUnlocked)
	if err != nil {
		return Snapshot{}, err
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, ErrUnknownResult
	}
	return snapshot, nil
}

// ReadAuthorized holds a canonical Store row lock while reading its current
// availability. The earlier service-level grant check cannot itself prevent
// an ownership transfer between the check and a separate snapshot query.
// This read transaction does not mutate business state, but cannot be marked
// SQL read-only because PostgreSQL row locks are required for revocation safety.
func (r *PostgresRepository) ReadAuthorized(ctx context.Context, storeID, actorID, authoritySource string) (Snapshot, error) {
	if strings.TrimSpace(storeID) == "" {
		return Snapshot{}, ErrStoreMissing
	}
	if strings.TrimSpace(actorID) == "" ||
		(authoritySource != "MERCHANT_STORE_GRANT" && authoritySource != "OPERATOR_OPERATIONS") {
		return Snapshot{}, ErrForbidden
	}
	tx, err := beginScopedStoreTx(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	var currentOwner string
	err = tx.QueryRowContext(ctx, `SELECT owner_actor_id FROM stores WHERE id=$1 FOR SHARE`, storeID).Scan(&currentOwner)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, ErrStoreMissing
	}
	if err != nil {
		return Snapshot{}, normalizePgError(err)
	}
	if authoritySource == "MERCHANT_STORE_GRANT" && currentOwner != actorID {
		return Snapshot{}, ErrForbidden
	}
	snapshot, err := r.readSnapshot(ctx, tx, storeID, snapshotSharedLock)
	if err != nil {
		return Snapshot{}, normalizePgError(err)
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, ErrUnknownResult
	}
	return snapshot, nil
}

func (r *PostgresRepository) ensureStore(ctx context.Context, tx *sql.Tx, storeID string) error {
	query := "SELECT id FROM stores WHERE id=$1"
	var id string
	if err := tx.QueryRowContext(ctx, query, storeID).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrStoreMissing
		}
		return err
	}
	return nil
}

type snapshotRowLock uint8

const (
	snapshotUnlocked snapshotRowLock = iota
	snapshotSharedLock
	snapshotExclusiveLock
)

func (r *PostgresRepository) readSnapshot(ctx context.Context, tx *sql.Tx, id string, rowLock snapshotRowLock) (Snapshot, error) {
	q := `SELECT store_timezone,paused_until,preparation_minutes,version,changed_by_actor,change_reason
		FROM store_operational_availability WHERE store_id=$1`
	switch rowLock {
	case snapshotUnlocked:
	case snapshotSharedLock:
		q += " FOR SHARE"
	case snapshotExclusiveLock:
		q += " FOR UPDATE"
	default:
		return Snapshot{}, ErrInvalidChange
	}
	var snapshot Snapshot
	snapshot.StoreID = id
	snapshot.Weekly = []WeeklyWindow{}
	var until sql.NullTime
	var prep sql.NullInt64
	err := tx.QueryRowContext(ctx, q, id).Scan(&snapshot.Timezone, &until, &prep,
		&snapshot.Version, &snapshot.ActingActorID, &snapshot.Reason)
	if errors.Is(err, sql.ErrNoRows) {
		// A real Store with no explicit schedule remains closed; there is
		// deliberately no invented 24-hour open default.
		snapshot.Version = 1
		return snapshot, nil
	}
	if err != nil {
		return Snapshot{}, err
	}
	if until.Valid {
		value := until.Time.UTC()
		snapshot.PausedUntil = &value
	}
	if prep.Valid {
		snapshot.PreparationMinutes = int(prep.Int64)
	}
	rows, err := tx.QueryContext(ctx, `SELECT weekday,opens_minute,closes_minute
		FROM store_operational_weekly_hours WHERE store_id=$1 ORDER BY weekday,opens_minute`, id)
	if err != nil {
		return Snapshot{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var day int
		var window WeeklyWindow
		if err = rows.Scan(&day, &window.Opens, &window.Closes); err != nil {
			return Snapshot{}, err
		}
		window.Weekday = time.Weekday(day)
		snapshot.Weekly = append(snapshot.Weekly, window)
	}
	if err = rows.Err(); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}
func commandHash(c AuthorizedChange) (string, error) {
	encoded, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
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
	committed, found, lookupErr := r.committedOperation(ctx, c.StoreID, c.OperationID, hash)
	if errors.Is(lookupErr, ErrOperationConflict) {
		return Snapshot{}, false, ErrOperationConflict
	}
	if lookupErr != nil {
		return Snapshot{}, false, ErrUnknownResult
	}
	if found {
		return committed, true, nil
	}
	return Snapshot{}, false, err
}

// committedOperation is a fresh durable read, after the failed transaction
// rolled back. It verifies both operation key and immutable payload/actor hash.
func (r *PostgresRepository) committedOperation(ctx context.Context, storeID, operationID, hash string) (Snapshot, bool, error) {
	tx, err := beginScopedStoreTx(ctx, r.db, r.schema, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Snapshot{}, false, err
	}
	defer tx.Rollback()
	var storedHash string
	var encoded []byte
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result_snapshot
		FROM store_operational_commands WHERE store_id=$1 AND operation_id=$2`,
		storeID, operationID).Scan(&storedHash, &encoded)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, false, nil
	}
	if err != nil {
		return Snapshot{}, false, err
	}
	if storedHash != hash {
		return Snapshot{}, false, ErrOperationConflict
	}
	var snapshot Snapshot
	if err = json.Unmarshal(encoded, &snapshot); err != nil {
		return Snapshot{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, false, err
	}
	return snapshot, true, nil
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
	tx, err := beginScopedStoreTx(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelSerializable})
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
func normalizePgError(err error) error {
	var pg *pq.Error
	if errors.As(err, &pg) && pg.Code == "40001" {
		return ErrVersionConflict
	}
	return err
}
