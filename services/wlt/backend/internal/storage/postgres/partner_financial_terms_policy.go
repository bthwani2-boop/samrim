package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var (
	ErrPartnerFinancialTermsPolicyInvalidInput = errors.New("partner financial terms policy input is invalid")
	ErrPartnerFinancialTermsPolicyNotFound     = errors.New("active partner financial terms policy was not found")
)

type PartnerFinancialTermsPolicyRecord struct {
	ID                string
	PolicyVersion     string
	State             string
	CommissionRateBps int
	SettlementPeriod  string
	Version           int
	CreatedBy         string
	CreatedAt         time.Time
	RetiredAt         *time.Time
}

type CreatePartnerFinancialTermsPolicyInput struct {
	CommissionRateBps int
	SettlementPeriod  string
	ExpectedVersion   int
	Reason            string
	ActingActorID     string
	IdempotencyKey    string
	CorrelationID     string
}

func HashPartnerFinancialTermsPolicyRequest(input CreatePartnerFinancialTermsPolicyInput) string {
	return hashFacts("partner-financial-terms-policy", strconv.Itoa(input.CommissionRateBps), strings.ToUpper(strings.TrimSpace(input.SettlementPeriod)), strconv.Itoa(input.ExpectedVersion), strings.TrimSpace(input.Reason))
}

func ReadPartnerFinancialTermsPolicy(ctx context.Context, db *sql.DB) (PartnerFinancialTermsPolicyRecord, error) {
	if db == nil {
		return PartnerFinancialTermsPolicyRecord{}, ErrPartnerFinancialTermsPolicyInvalidInput
	}
	return readPartnerFinancialTermsPolicyRow(db.QueryRowContext(ctx, `SELECT id,policy_version,state,commission_rate_bps,settlement_period,version,created_by,created_at,retired_at FROM wlt.partner_financial_terms_policies WHERE state='ACTIVE'`))
}

func CreatePartnerFinancialTermsPolicy(ctx context.Context, db *sql.DB, input CreatePartnerFinancialTermsPolicyInput) (PartnerFinancialTermsPolicyRecord, bool, error) {
	input.SettlementPeriod = strings.ToUpper(strings.TrimSpace(input.SettlementPeriod))
	input.Reason = strings.Join(strings.Fields(strings.TrimSpace(input.Reason)), " ")
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.CommissionRateBps < 0 || input.CommissionRateBps > 10000 || (input.SettlementPeriod != "DAILY" && input.SettlementPeriod != "WEEKLY" && input.SettlementPeriod != "MONTHLY") || input.ExpectedVersion < 0 || len(input.Reason) < 5 || len(input.Reason) > 500 || input.ActingActorID == "" || len(input.ActingActorID) > 128 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PartnerFinancialTermsPolicyRecord{}, false, ErrPartnerFinancialTermsPolicyInvalidInput
	}
	requestHash := HashPartnerFinancialTermsPolicyRequest(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerFinancialTermsPolicyRecord{}, false, fmt.Errorf("begin partner financial terms policy: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended('wlt:partner-financial-terms-policy',0))"); err != nil {
		return PartnerFinancialTermsPolicyRecord{}, false, err
	}
	var policyID, storedHash string
	err = tx.QueryRowContext(ctx, `SELECT policy_id,request_hash FROM wlt.partner_financial_terms_policy_events WHERE idempotency_key=$1 FOR UPDATE`, input.IdempotencyKey).Scan(&policyID, &storedHash)
	if err == nil {
		if storedHash != requestHash {
			return PartnerFinancialTermsPolicyRecord{}, false, ErrIdempotencyConflict
		}
		policy, readErr := readPartnerFinancialTermsPolicyByID(ctx, tx, policyID)
		if readErr != nil {
			return PartnerFinancialTermsPolicyRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PartnerFinancialTermsPolicyRecord{}, false, err
		}
		return policy, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialTermsPolicyRecord{}, false, err
	}
	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT version FROM wlt.partner_financial_terms_policies WHERE state='ACTIVE' FOR UPDATE`).Scan(&currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialTermsPolicyRecord{}, false, err
	}
	if input.ExpectedVersion != currentVersion {
		return PartnerFinancialTermsPolicyRecord{}, false, ErrVersionConflict
	}
	version := currentVersion + 1
	policyID, err = newID("partner-financial-terms")
	if err != nil {
		return PartnerFinancialTermsPolicyRecord{}, false, err
	}
	policyVersion := fmt.Sprintf("partner-financial-terms:v%d", version)
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.partner_financial_terms_policies SET state='RETIRED',retired_at=clock_timestamp() WHERE state='ACTIVE'`); err != nil {
		return PartnerFinancialTermsPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_financial_terms_policies(id,policy_version,state,commission_rate_bps,settlement_period,version,created_by) VALUES($1,$2,'ACTIVE',$3,$4,$5,$6)`, policyID, policyVersion, input.CommissionRateBps, input.SettlementPeriod, version, input.ActingActorID); err != nil {
		return PartnerFinancialTermsPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_financial_terms_policy_events(policy_id,event_type,policy_version,request_hash,idempotency_key,correlation_id,acting_actor_id,expected_version,change_reason) VALUES($1,'PARTNER_FINANCIAL_TERMS_POLICY_ACTIVATED',$2,$3,$4,$5,$6,$7,$8)`, policyID, policyVersion, requestHash, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, input.ExpectedVersion, input.Reason); err != nil {
		return PartnerFinancialTermsPolicyRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerFinancialTermsPolicyRecord{}, false, err
	}
	policy, err := ReadPartnerFinancialTermsPolicy(ctx, db)
	return policy, false, err
}

type partnerFinancialTermsPolicyQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readPartnerFinancialTermsPolicyByID(ctx context.Context, query partnerFinancialTermsPolicyQuerier, id string) (PartnerFinancialTermsPolicyRecord, error) {
	return readPartnerFinancialTermsPolicyRow(query.QueryRowContext(ctx, `SELECT id,policy_version,state,commission_rate_bps,settlement_period,version,created_by,created_at,retired_at FROM wlt.partner_financial_terms_policies WHERE id=$1`, id))
}

func readPartnerFinancialTermsPolicyRow(row *sql.Row) (PartnerFinancialTermsPolicyRecord, error) {
	var result PartnerFinancialTermsPolicyRecord
	var retiredAt sql.NullTime
	err := row.Scan(&result.ID, &result.PolicyVersion, &result.State, &result.CommissionRateBps, &result.SettlementPeriod, &result.Version, &result.CreatedBy, &result.CreatedAt, &retiredAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialTermsPolicyRecord{}, ErrPartnerFinancialTermsPolicyNotFound
	}
	if err != nil {
		return PartnerFinancialTermsPolicyRecord{}, err
	}
	if retiredAt.Valid {
		result.RetiredAt = &retiredAt.Time
	}
	return result, nil
}
