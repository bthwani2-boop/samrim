package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

var ErrCaptainMinimumBalancePolicyNotFound = errors.New("captain minimum balance policy not configured")
var ErrCaptainMinimumBalancePolicyInvalid = errors.New("captain minimum balance policy input invalid")

type CaptainMinimumBalancePolicy struct {
	ID                    string     `json:"id"`
	Version               int        `json:"version"`
	MinimumAvailableMinor int64      `json:"minimumAvailableMinor"`
	Currency              string     `json:"currency"`
	State                 string     `json:"state"`
	CreatedBy             string     `json:"createdBy"`
	ChangeReason          string     `json:"changeReason"`
	CreatedAt             time.Time  `json:"createdAt"`
	RetiredAt             *time.Time `json:"retiredAt"`
}
type CreateCaptainMinimumBalancePolicyInput struct {
	MinimumAvailableMinor int64
	ExpectedVersion       int
	Reason                string
	ActingActorID         string
	IdempotencyKey        string
	CorrelationID         string
}

func HashCaptainMinimumBalancePolicy(input CreateCaptainMinimumBalancePolicyInput) string {
	return hashFacts("captain-minimum-balance-policy", strconv.FormatInt(input.MinimumAvailableMinor, 10), strconv.Itoa(input.ExpectedVersion), strings.TrimSpace(input.Reason), strings.TrimSpace(input.ActingActorID))
}
func readCaptainMinimumBalanceRow(row *sql.Row) (CaptainMinimumBalancePolicy, error) {
	var p CaptainMinimumBalancePolicy
	var retired sql.NullTime
	err := row.Scan(&p.ID, &p.Version, &p.MinimumAvailableMinor, &p.Currency, &p.State, &p.CreatedBy, &p.ChangeReason, &p.CreatedAt, &retired)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrCaptainMinimumBalancePolicyNotFound
	}
	if err != nil {
		return p, err
	}
	if retired.Valid {
		p.RetiredAt = &retired.Time
	}
	return p, nil
}

const captainMinimumBalanceColumns = "id,version,minimum_available_minor,currency,state,created_by,change_reason,created_at,retired_at"

func ReadCaptainMinimumBalancePolicy(ctx context.Context, db *sql.DB) (CaptainMinimumBalancePolicy, error) {
	if db == nil {
		return CaptainMinimumBalancePolicy{}, ErrCaptainMinimumBalancePolicyInvalid
	}
	return readCaptainMinimumBalanceRow(db.QueryRowContext(ctx, "SELECT "+captainMinimumBalanceColumns+" FROM wlt.captain_minimum_balance_policies WHERE state='ACTIVE'"))
}
func ReadCaptainMinimumBalancePolicyHistory(ctx context.Context, db *sql.DB, limit int) ([]CaptainMinimumBalancePolicy, error) {
	if db == nil || limit < 1 || limit > 100 {
		return nil, ErrCaptainMinimumBalancePolicyInvalid
	}
	rows, err := db.QueryContext(ctx, "SELECT "+captainMinimumBalanceColumns+" FROM wlt.captain_minimum_balance_policies ORDER BY version DESC LIMIT $1", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]CaptainMinimumBalancePolicy, 0)
	for rows.Next() {
		var p CaptainMinimumBalancePolicy
		var retired sql.NullTime
		if err = rows.Scan(&p.ID, &p.Version, &p.MinimumAvailableMinor, &p.Currency, &p.State, &p.CreatedBy, &p.ChangeReason, &p.CreatedAt, &retired); err != nil {
			return nil, err
		}
		if retired.Valid {
			p.RetiredAt = &retired.Time
		}
		result = append(result, p)
	}
	return result, rows.Err()
}
func CreateCaptainMinimumBalancePolicy(ctx context.Context, db *sql.DB, input CreateCaptainMinimumBalancePolicyInput) (CaptainMinimumBalancePolicy, bool, error) {
	input.Reason = strings.Join(strings.Fields(strings.TrimSpace(input.Reason)), " ")
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.MinimumAvailableMinor <= 0 || input.ExpectedVersion < 0 ||
		len(input.Reason) < 5 || len(input.Reason) > 500 || len(input.ActingActorID) < 1 || len(input.ActingActorID) > 128 ||
		len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return CaptainMinimumBalancePolicy{}, false, ErrCaptainMinimumBalancePolicyInvalid
	}
	hash := HashCaptainMinimumBalancePolicy(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainMinimumBalancePolicy{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:captain-minimum-balance-policy',0))"); err != nil {
		return CaptainMinimumBalancePolicy{}, false, err
	}
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.captain_minimum_balance_policies WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != hash {
			return CaptainMinimumBalancePolicy{}, false, ErrIdempotencyConflict
		}
		record, readErr := readCaptainMinimumBalanceRow(tx.QueryRowContext(ctx, "SELECT "+captainMinimumBalanceColumns+" FROM wlt.captain_minimum_balance_policies WHERE id=$1", existingID))
		if readErr != nil {
			return CaptainMinimumBalancePolicy{}, false, readErr
		}
		if err = tx.Commit(); err != nil {
			return CaptainMinimumBalancePolicy{}, false, err
		}
		return record, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainMinimumBalancePolicy{}, false, err
	}
	var current int
	err = tx.QueryRowContext(ctx, "SELECT version FROM wlt.captain_minimum_balance_policies WHERE state='ACTIVE' FOR UPDATE").Scan(&current)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CaptainMinimumBalancePolicy{}, false, err
	}
	if current != input.ExpectedVersion {
		return CaptainMinimumBalancePolicy{}, false, ErrVersionConflict
	}
	id, err := newID("captain-min-balance")
	if err != nil {
		return CaptainMinimumBalancePolicy{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE wlt.captain_minimum_balance_policies SET state='RETIRED',retired_at=clock_timestamp() WHERE state='ACTIVE'"); err != nil {
		return CaptainMinimumBalancePolicy{}, false, err
	}
	var result CaptainMinimumBalancePolicy
	var retired sql.NullTime
	err = tx.QueryRowContext(ctx, `INSERT INTO wlt.captain_minimum_balance_policies(id,version,minimum_available_minor,state,created_by,change_reason,idempotency_key,request_hash,correlation_id)
 VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8)
 RETURNING `+captainMinimumBalanceColumns, id, current+1, input.MinimumAvailableMinor, input.ActingActorID, input.Reason, input.IdempotencyKey, hash, input.CorrelationID).
		Scan(&result.ID, &result.Version, &result.MinimumAvailableMinor, &result.Currency, &result.State, &result.CreatedBy, &result.ChangeReason, &result.CreatedAt, &retired)
	if err != nil {
		return CaptainMinimumBalancePolicy{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CaptainMinimumBalancePolicy{}, false, err
	}
	return result, false, nil
}
