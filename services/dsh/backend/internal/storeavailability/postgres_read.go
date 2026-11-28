package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"strings"
	"time"
)

func (r *PostgresRepository) Read(ctx context.Context, storeID string) (Snapshot, error) {
	if strings.TrimSpace(storeID) == "" {
		return Snapshot{}, ErrStoreMissing
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}, "stores", "service_cities", "store_operational_availability", "store_operational_weekly_hours")
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
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, "stores", "service_cities", "store_operational_availability", "store_operational_weekly_hours")
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
		// deliberately no invented 24-hour open default. Preserve the distinction
		// between an unconfigured schedule (null) and an explicit closure ([]).
		snapshot.Timezone, err = readStoreTimezone(ctx, tx, id)
		if err != nil {
			return Snapshot{}, err
		}
		snapshot.Weekly = nil
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
