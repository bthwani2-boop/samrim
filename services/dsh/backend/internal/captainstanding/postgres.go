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

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

// PostgresRepository owns only DSH Captain standing. Every operation binds
// the exact owner relations in a transaction, without constructing SQL text.
type PostgresRepository struct {
	db     *sql.DB
	schema string
}

var isolatedSchema = regexp.MustCompile("^dsh_test_[a-z0-9_]+$")

func NewPostgresRepository(db *sql.DB, schema string) (*PostgresRepository, error) {
	if db == nil || len(schema) > 63 || !isolatedSchema.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	return &PostgresRepository{db: db, schema: schema}, nil
}

func scanStanding(row interface{ Scan(...any) error }) (Standing, error) {
	var result Standing
	err := row.Scan(&result.ActorID, &result.Status, &result.Version)
	return result, err
}

func (r *PostgresRepository) Read(ctx context.Context, actorID string) (Standing, error) {
	if r == nil || r.db == nil || !validActorID(actorID) {
		return Standing{}, ErrInvalidChange
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{ReadOnly: true}, "captain_standing")
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	defer tx.Rollback()
	result, err := scanStanding(tx.QueryRowContext(ctx, "SELECT actor_id,status,version FROM captain_standing WHERE actor_id=$1", actorID))
	if errors.Is(err, sql.ErrNoRows) {
		return Standing{}, ErrNotEligible
	}
	if err != nil || tx.Commit() != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	return result, nil
}

// List exposes only the review projection, not personal or audit data.
func (r *PostgresRepository) List(ctx context.Context, status Status, after string, limit int) ([]Standing, error) {
	if r == nil || r.db == nil || !reviewStatus(status) || limit < 1 || limit > 51 || (after != "" && !reviewActorID(after)) {
		return nil, ErrInvalidChange
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{ReadOnly: true}, "captain_standing")
	if err != nil {
		return nil, ErrOwnerUnavailable
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT actor_id,status,version FROM captain_standing WHERE status=$1 AND ($2='' OR actor_id>$2) ORDER BY actor_id LIMIT $3", status, after, limit)
	if err != nil {
		return nil, ErrOwnerUnavailable
	}
	defer rows.Close()
	items := []Standing{}
	for rows.Next() {
		item, err := scanStanding(rows)
		if err != nil {
			return nil, ErrOwnerUnavailable
		}
		items = append(items, item)
	}
	if rows.Err() != nil || rows.Close() != nil || tx.Commit() != nil {
		return nil, ErrOwnerUnavailable
	}
	return items, nil
}

// Apply never reactivates an existing standing, including concurrent retries.
func (r *PostgresRepository) Apply(ctx context.Context, actorID string) (Standing, error) {
	if r == nil || r.db == nil || !validActorID(actorID) {
		return Standing{}, ErrInvalidChange
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, "captain_standing")
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "INSERT INTO captain_standing (actor_id,status,version,changed_by_actor,change_reason) VALUES ($1,'PENDING',1,$1,'Verified Customer application') ON CONFLICT (actor_id) DO NOTHING", actorID); err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	result, err := scanStanding(tx.QueryRowContext(ctx, "SELECT actor_id,status,version FROM captain_standing WHERE actor_id=$1 FOR SHARE", actorID))
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	if tx.Commit() != nil {
		return Standing{}, ErrUnknownResult
	}
	return result, nil
}

func hashCommand(c Change) (string, error) {
	raw, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func validDecision(c Change) bool {
	return validActorID(c.ActorID) && validActorID(c.ActingActorID) &&
		c.ExpectedVersion >= 1 && operationID.MatchString(c.OperationID) &&
		(c.Status == Approved || c.Status == Suspended || c.Status == Revoked) &&
		strings.TrimSpace(c.Reason) != "" && len([]rune(c.Reason)) <= 300
}

// Change locks the applicant before checking immutable operation identity.
// The decision, replay record and audit commit together on the same owner.
func (r *PostgresRepository) Change(ctx context.Context, c Change) (Standing, error) {
	if r == nil || r.db == nil || !validDecision(c) {
		return Standing{}, ErrInvalidChange
	}
	fingerprint, err := hashCommand(c)
	if err != nil {
		return Standing{}, ErrInvalidChange
	}
	tx, err := dbscope.Begin(ctx, r.db, r.schema, &sql.TxOptions{Isolation: sql.LevelReadCommitted},
		"captain_standing", "captain_standing_commands", "captain_standing_audit")
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	defer tx.Rollback()

	old, err := scanStanding(tx.QueryRowContext(ctx, "SELECT actor_id,status,version FROM captain_standing WHERE actor_id=$1 FOR UPDATE", c.ActorID))
	if errors.Is(err, sql.ErrNoRows) {
		return Standing{}, ErrNotEligible
	}
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}

	var priorHash string
	var priorVersion int64
	err = tx.QueryRowContext(ctx, "SELECT request_hash,resulting_version FROM captain_standing_commands WHERE actor_id=$1 AND operation_id=$2", c.ActorID, c.OperationID).Scan(&priorHash, &priorVersion)
	if err == nil {
		if priorHash != fingerprint {
			return Standing{}, ErrVersionConflict
		}
		var priorStatus Status
		if err := tx.QueryRowContext(ctx, "SELECT new_status FROM captain_standing_audit WHERE actor_id=$1 AND operation_id=$2 AND version=$3", c.ActorID, c.OperationID, priorVersion).Scan(&priorStatus); err != nil {
			return Standing{}, ErrOwnerUnavailable
		}
		if tx.Commit() != nil {
			return Standing{}, ErrUnknownResult
		}
		return Standing{ActorID: c.ActorID, Status: priorStatus, Version: priorVersion}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Standing{}, ErrOwnerUnavailable
	}

	if old.Version != c.ExpectedVersion || old.Status == Revoked ||
		(c.Status == Approved && old.Status != Pending) || old.Status == c.Status {
		return Standing{}, ErrVersionConflict
	}
	next, err := scanStanding(tx.QueryRowContext(ctx, "UPDATE captain_standing SET status=$2,version=version+1,changed_by_actor=$3,change_reason=$4,updated_at=clock_timestamp() WHERE actor_id=$1 AND version=$5 RETURNING actor_id,status,version",
		c.ActorID, c.Status, c.ActingActorID, c.Reason, c.ExpectedVersion))
	if errors.Is(err, sql.ErrNoRows) {
		return Standing{}, ErrVersionConflict
	}
	if err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO captain_standing_commands (actor_id,operation_id,request_hash,resulting_version) VALUES($1,$2,$3,$4)", c.ActorID, c.OperationID, fingerprint, next.Version); err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO captain_standing_audit (actor_id,version,operation_id,previous_status,new_status,acting_actor_id,change_reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
		c.ActorID, next.Version, c.OperationID, old.Status, next.Status, c.ActingActorID, c.Reason); err != nil {
		return Standing{}, ErrOwnerUnavailable
	}
	if tx.Commit() != nil {
		return Standing{}, ErrUnknownResult
	}
	return next, nil
}
