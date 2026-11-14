package storeavailability

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
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
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	if err = r.ensureStore(ctx, tx, storeID); err != nil {
		return Snapshot{}, err
	}
	snapshot, err := r.readSnapshot(ctx, tx, storeID, false)
	if err != nil {
		return Snapshot{}, err
	}
	if err = tx.Commit(); err != nil {
		return Snapshot{}, ErrUnknownResult
	}
	return snapshot, nil
}

func (r *PostgresRepository) ensureStore(ctx context.Context, tx *sql.Tx, storeID string) error {
	query := fmt.Sprintf("SELECT id FROM %s.stores WHERE id=$1", r.schema)
	var id string
	if err := tx.QueryRowContext(ctx, query, storeID).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrStoreMissing
		}
		return err
	}
	return nil
}

func (r *PostgresRepository) readSnapshot(ctx context.Context, tx *sql.Tx, id string, lock bool) (Snapshot, error) {
	q := fmt.Sprintf(`SELECT store_timezone,paused_until,preparation_minutes,version,changed_by_actor,change_reason
		FROM %s.store_operational_availability WHERE store_id=$1`, r.schema)
	if lock {
		q += " FOR UPDATE"
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
	rows, err := tx.QueryContext(ctx, fmt.Sprintf(`SELECT weekday,opens_minute,closes_minute
		FROM %s.store_operational_weekly_hours WHERE store_id=$1 ORDER BY weekday,opens_minute`, r.schema), id)
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
	var storedHash string
	var encoded []byte
	err := r.db.QueryRowContext(ctx, fmt.Sprintf(`SELECT request_hash,result_snapshot
		FROM %s.store_operational_commands WHERE store_id=$1 AND operation_id=$2`, r.schema),
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
	return snapshot, true, nil
}

func (r *PostgresRepository) applyOnce(ctx context.Context, c AuthorizedChange, hash string) (Snapshot, bool, error) {
	if c.StoreID == "" || c.ActorID == "" || !operationIDRule.MatchString(c.OperationID) {
		return Snapshot{}, false, ErrInvalidChange
	}
	if err := ValidateSchedule(c.Weekly); err != nil {
		return Snapshot{}, false, err
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return Snapshot{}, false, err
	}
	defer tx.Rollback()
	// Lock the canonical Store/City authority while applying this change. An
	// ownership transfer or timezone update racing this transaction must not
	// authorize a stale mutation.
	if c.AuthoritySource != "MERCHANT_STORE_GRANT" && c.AuthoritySource != "OPERATOR_OPERATIONS" {
		return Snapshot{}, false, ErrForbidden
	}
	var currentOwner string
	var authoritativeTimezone sql.NullString
	err = tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT s.owner_actor_id, city.timezone_name
		FROM %s.stores s JOIN %s.service_cities city ON city.id=s.city_id
		WHERE s.id=$1 FOR SHARE OF s,city`, r.schema, r.schema), c.StoreID).
		Scan(&currentOwner, &authoritativeTimezone)
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, false, ErrStoreMissing
	}
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	if c.AuthoritySource == "MERCHANT_STORE_GRANT" && currentOwner != c.ActorID {
		return Snapshot{}, false, ErrForbidden
	}
	if !authoritativeTimezone.Valid || authoritativeTimezone.String != c.Timezone {
		return Snapshot{}, false, ErrInvalidTimezone
	}
	if _, err = time.LoadLocation(c.Timezone); err != nil {
		return Snapshot{}, false, ErrInvalidTimezone
	}
	// A first Store update creates an explicitly closed schedule record,
	// inside the same transaction as the first authorized operation.
	_, err = tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.store_operational_availability
		(store_id,store_timezone,changed_by_actor,change_reason)
		VALUES ($1,$2,$3,$4) ON CONFLICT (store_id) DO NOTHING`, r.schema),
		c.StoreID, c.Timezone, c.ActorID, "Initial Store availability configuration")
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	// Stable operation ID is looked up BEFORE expected-version checking:
	// an ambiguous commit can safely be reconciled as an idempotent replay.
	var storedHash string
	var storedJSON []byte
	err = tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT request_hash,result_snapshot
		FROM %s.store_operational_commands WHERE store_id=$1 AND operation_id=$2`, r.schema),
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
	before, err := r.readSnapshot(ctx, tx, c.StoreID, true)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	if before.Version != c.ExpectedVersion {
		return Snapshot{}, false, ErrVersionConflict
	}
	after := Snapshot{
		StoreID: c.StoreID, Timezone: c.Timezone, Weekly: append([]WeeklyWindow{}, c.Weekly...),
		PausedUntil: c.PausedUntil, PreparationMinutes: c.PreparationMinutes,
		Version: before.Version + 1, ActingActorID: c.ActorID, Reason: c.Reason,
	}
	_, err = tx.ExecContext(ctx, fmt.Sprintf(`UPDATE %s.store_operational_availability SET
		store_timezone=$2,paused_until=$3,preparation_minutes=$4,version=$5,
		changed_by_actor=$6,change_reason=$7,updated_at=now()
		WHERE store_id=$1`, r.schema), c.StoreID, c.Timezone, c.PausedUntil,
		c.PreparationMinutes, after.Version, c.ActorID, c.Reason)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	_, err = tx.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s.store_operational_weekly_hours WHERE store_id=$1", r.schema), c.StoreID)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	for _, window := range after.Weekly {
		_, err = tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.store_operational_weekly_hours
			(store_id,weekday,opens_minute,closes_minute) VALUES($1,$2,$3,$4)`, r.schema),
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
	_, err = tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.store_operational_commands
		(store_id,operation_id,request_hash,resulting_version,result_snapshot)
		VALUES ($1,$2,$3,$4,$5)`, r.schema),
		c.StoreID, c.OperationID, hash, after.Version, afterJSON)
	if err != nil {
		return Snapshot{}, false, normalizePgError(err)
	}
	_, err = tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.store_operational_audit
		(store_id,operation_id,acting_actor_id,authority_source,reason,before_snapshot,after_snapshot)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, r.schema),
		c.StoreID, c.OperationID, c.ActorID, c.AuthoritySource, c.Reason, beforeJSON, afterJSON)
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
