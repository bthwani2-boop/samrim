package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrStageSLAPolicyInvalid  = errors.New("stage SLA approval invalid")
	ErrStageSLAPolicyConflict = errors.New("stage SLA approval conflict")
)

type StageSLAPolicy struct {
	FulfillmentMode   string    `json:"fulfillmentMode"`
	Stage             string    `json:"stage"`
	TargetMinutes     int       `json:"targetMinutes"`
	WarningMinutes    int       `json:"warningMinutes"`
	Version           int       `json:"version"`
	EffectiveAt       time.Time `json:"effectiveAt"`
	ApprovedByActorID string    `json:"approvedByActorId"`
}

type StageSLAPolicyInput struct {
	FulfillmentMode string `json:"fulfillmentMode"`
	Stage           string `json:"stage"`
	TargetMinutes   int    `json:"targetMinutes"`
	WarningMinutes  int    `json:"warningMinutes"`
	ExpectedVersion int    `json:"expectedVersion"`
}

func validStageSLAPolicy(input StageSLAPolicyInput) bool {
	switch input.FulfillmentMode {
	case "BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP":
	default:
		return false
	}
	switch input.Stage {
	case "CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED", "IN_CUSTODY":
	default:
		return false
	}
	if input.FulfillmentMode == "CUSTOMER_PICKUP" && (input.Stage == "READY_FOR_DISPATCH" || input.Stage == "CAPTAIN_ASSIGNED" || input.Stage == "IN_CUSTODY") {
		return false
	}
	if input.FulfillmentMode != "CUSTOMER_PICKUP" && input.Stage == "READY_FOR_PICKUP" {
		return false
	}
	if input.FulfillmentMode == "PARTNER_CAPTAIN" && input.Stage == "READY_FOR_DISPATCH" {
		return false
	}
	return input.TargetMinutes >= 1 && input.TargetMinutes <= 1440 &&
		input.WarningMinutes >= 0 && input.WarningMinutes < input.TargetMinutes &&
		input.ExpectedVersion >= 0
}

func stageSLARequestHash(input StageSLAPolicyInput) string {
	facts := fmt.Sprintf("%s|%s|%d|%d|%d", input.FulfillmentMode, input.Stage, input.TargetMinutes, input.WarningMinutes, input.ExpectedVersion)
	h := sha256.Sum256([]byte(facts))
	return hex.EncodeToString(h[:])
}

func ReadOperatorStageSLAPolicies(ctx context.Context, db *sql.DB) ([]StageSLAPolicy, error) {
	rows, err := db.QueryContext(ctx, `SELECT DISTINCT ON(fulfillment_mode,stage)
 fulfillment_mode,stage,target_minutes,warning_minutes,policy_version,effective_at,approved_by_actor_id
 FROM dsh.operator_stage_sla_policies
 WHERE effective_at<=clock_timestamp()
 ORDER BY fulfillment_mode,stage,policy_version DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]StageSLAPolicy, 0, 21)
	for rows.Next() {
		var p StageSLAPolicy
		if err := rows.Scan(&p.FulfillmentMode, &p.Stage, &p.TargetMinutes, &p.WarningMinutes, &p.Version, &p.EffectiveAt, &p.ApprovedByActorID); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

func CreateOperatorStageSLAPolicy(ctx context.Context, db *sql.DB, input StageSLAPolicyInput, actor, key, correlation string) (StageSLAPolicy, bool, error) {
	actor = strings.TrimSpace(actor)
	key = strings.TrimSpace(key)
	correlation = strings.TrimSpace(correlation)
	if !validStageSLAPolicy(input) || len(actor) < 1 || len(actor) > 128 || len(key) < 8 || len(key) > 128 || len(correlation) < 8 || len(correlation) > 128 {
		return StageSLAPolicy{}, false, ErrStageSLAPolicyInvalid
	}
	hash := stageSLARequestHash(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StageSLAPolicy{}, false, err
	}
	defer tx.Rollback()
	// Serialize all requests for one mode + stage, including simultaneous first versions.
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, input.FulfillmentMode+":"+input.Stage); err != nil {
		return StageSLAPolicy{}, false, err
	}
	var savedHash string
	var saved StageSLAPolicy
	err = tx.QueryRowContext(ctx, `SELECT e.request_hash,p.fulfillment_mode,p.stage,p.target_minutes,p.warning_minutes,p.policy_version,p.effective_at,p.approved_by_actor_id
 FROM dsh.operator_stage_sla_policy_events e JOIN dsh.operator_stage_sla_policies p ON p.id=e.policy_id WHERE e.idempotency_key=$1`, key).
		Scan(&savedHash, &saved.FulfillmentMode, &saved.Stage, &saved.TargetMinutes, &saved.WarningMinutes, &saved.Version, &saved.EffectiveAt, &saved.ApprovedByActorID)
	if err == nil {
		if savedHash != hash || saved.ApprovedByActorID != actor {
			return StageSLAPolicy{}, false, ErrStageSLAPolicyConflict
		}
		if err = tx.Commit(); err != nil {
			return StageSLAPolicy{}, false, err
		}
		return saved, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StageSLAPolicy{}, false, err
	}
	var latest int
	err = tx.QueryRowContext(ctx, `SELECT policy_version FROM dsh.operator_stage_sla_policies
 WHERE fulfillment_mode=$1 AND stage=$2 ORDER BY policy_version DESC LIMIT 1`, input.FulfillmentMode, input.Stage).Scan(&latest)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return StageSLAPolicy{}, false, err
	}
	if latest != input.ExpectedVersion {
		return StageSLAPolicy{}, false, ErrStageSLAPolicyConflict
	}
	var policyID int64
	err = tx.QueryRowContext(ctx, `INSERT INTO dsh.operator_stage_sla_policies
 (fulfillment_mode,stage,target_minutes,warning_minutes,policy_version,effective_at,approved_by_actor_id)
 VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6)
 RETURNING id,fulfillment_mode,stage,target_minutes,warning_minutes,policy_version,effective_at,approved_by_actor_id`,
		input.FulfillmentMode, input.Stage, input.TargetMinutes, input.WarningMinutes, latest+1, actor).
		Scan(&policyID, &saved.FulfillmentMode, &saved.Stage, &saved.TargetMinutes, &saved.WarningMinutes, &saved.Version, &saved.EffectiveAt, &saved.ApprovedByActorID)
	if err != nil {
		return StageSLAPolicy{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.operator_stage_sla_policy_events
 (idempotency_key,policy_id,request_hash,actor_id,correlation_id) VALUES($1,$2,$3,$4,$5)`, key, policyID, hash, actor, correlation); err != nil {
		return StageSLAPolicy{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return StageSLAPolicy{}, false, err
	}
	return saved, false, nil
}
