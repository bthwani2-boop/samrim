package captainstanding

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/lib/pq"
)

// PostgresRepository writes only the isolated DSH Captain-standing owner table.
// No process here writes Identity roles, Store memberships, or WLT financial facts.
type PostgresRepository struct {
	db       *sql.DB
	table    string
	commands string
	audit    string
}

var isolatedSchema = regexp.MustCompile(`^dsh_test_[a-z0-9_]+$`)

func NewPostgresRepository(db *sql.DB, schema string) (*PostgresRepository, error) {
	if db == nil || len(schema) > 63 || !isolatedSchema.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	prefix := pq.QuoteIdentifier(schema) + "."
	return &PostgresRepository{
		db:       db,
		table:    prefix + "captain_standing",
		commands: prefix + "captain_standing_commands",
		audit:    prefix + "captain_standing_audit",
	}, nil
}

func (r *PostgresRepository) Read(ctx context.Context, actorID string) (Standing, error) {
	if r == nil || r.db == nil || !validActorID(actorID) {
		return Standing{}, ErrInvalidChange
	}
	var standing Standing
	err := r.db.QueryRowContext(ctx, `SELECT actor_id,status,version FROM `+r.table+` WHERE actor_id=$1`, actorID).
		Scan(&standing.ActorID, &standing.Status, &standing.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return Standing{}, ErrNotEligible
	}
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	return standing, nil
}

// Apply inserts one immutable pending application. ON CONFLICT does not update
// an old APPROVED, SUSPENDED or REVOKED record, even under concurrent retries.
func (r *PostgresRepository) Apply(ctx context.Context, actorID string) (Standing, error) {
	if r == nil || r.db == nil || !validActorID(actorID) {
		return Standing{}, ErrInvalidChange
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO `+r.table+`
		(actor_id,status,version,changed_by_actor,change_reason)
		VALUES ($1,'PENDING',1,$1,'Verified Customer application')
		ON CONFLICT (actor_id) DO NOTHING`, actorID)
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	var standing Standing
	err = tx.QueryRowContext(ctx, `SELECT actor_id,status,version FROM `+r.table+` WHERE actor_id=$1 FOR SHARE`, actorID).
		Scan(&standing.ActorID, &standing.Status, &standing.Version)
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	if err = tx.Commit(); err != nil {
		return Standing{}, ErrUnknownResult
	}
	return standing, nil
}

func hashCommand(c Change) (string, error) {
	raw, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// Change serializes one Operator approval/suspension/revocation on a row
// created by the verified applicant. Each decision has one immutable audit and
// operation-key record; a stale request cannot overwrite a newer decision.
func (r *PostgresRepository) Change(ctx context.Context, c Change) (Standing, error) {
	if r == nil || r.db == nil || !validActorID(c.ActorID) ||
		!validActorID(c.ActingActorID) || c.ExpectedVersion < 1 ||
		!operationID.MatchString(c.OperationID) ||
		(c.Status != Approved && c.Status != Suspended && c.Status != Revoked) ||
		strings.TrimSpace(c.Reason) == "" || len([]rune(c.Reason)) > 300 {
		return Standing{}, ErrInvalidChange
	}
	hash, err := hashCommand(c)
	if err != nil {
		return Standing{}, ErrInvalidChange
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	defer tx.Rollback()
	var old Standing
	err = tx.QueryRowContext(ctx, `SELECT actor_id,status,version FROM `+r.table+`
		WHERE actor_id=$1 FOR UPDATE`, c.ActorID).Scan(&old.ActorID, &old.Status, &old.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return Standing{}, ErrNotEligible
	}
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	var previousHash string
	var previousVersion int64
	err = tx.QueryRowContext(ctx, `SELECT request_hash,resulting_version FROM `+r.commands+`
		WHERE actor_id=$1 AND operation_id=$2`, c.ActorID, c.OperationID).Scan(&previousHash, &previousVersion)
	switch {
	case err == nil:
		if previousHash != hash {
			return Standing{}, ErrVersionConflict
		}
		// Even after subsequent decisions, replay returns the exact historical
		// result of this operation, never the newer active standing.
		var historicalStatus Status
		err = tx.QueryRowContext(ctx, `SELECT new_status FROM `+r.audit+`
			WHERE actor_id=$1 AND operation_id=$2 AND version=$3`,
			c.ActorID, c.OperationID, previousVersion).Scan(&historicalStatus)
		if err != nil {
			return Standing{}, ErrOwnerUnavailable
		}
		if err = tx.Commit(); err != nil {
			return Standing{}, ErrUnknownResult
		}
		return Standing{ActorID: c.ActorID, Status: historicalStatus, Version: previousVersion}, nil
	case !errors.Is(err, sql.ErrNoRows):
		return Standing{}, ErrOwnerUnavailable
	}
	if old.Version != c.ExpectedVersion || old.Status == Revoked ||
		(c.Status == Approved && old.Status != Pending) || old.Status == c.Status {
		return Standing{}, ErrVersionConflict
	}
	var next Standing
	err = tx.QueryRowContext(ctx, `UPDATE `+r.table+`
		SET status=$2,version=version+1,changed_by_actor=$3,change_reason=$4,
			updated_at=clock_timestamp()
		WHERE actor_id=$1 AND version=$5
		RETURNING actor_id,status,version`, c.ActorID, c.Status, c.ActingActorID, c.Reason, c.ExpectedVersion).
		Scan(&next.ActorID, &next.Status, &next.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return Standing{}, ErrVersionConflict
	}
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO `+r.commands+`
		(actor_id,operation_id,request_hash,resulting_version)
		VALUES($1,$2,$3,$4)`, c.ActorID, c.OperationID, hash, next.Version)
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO `+r.audit+`
		(actor_id,version,operation_id,previous_status,new_status,acting_actor_id,change_reason)
		VALUES($1,$2,$3,$4,$5,$6,$7)`,
		c.ActorID, next.Version, c.OperationID, old.Status, next.Status, c.ActingActorID, c.Reason)
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	if err = tx.Commit(); err != nil {
		return Standing{}, ErrUnknownResult
	}
	return next, nil
}
