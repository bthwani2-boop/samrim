package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrPartnerStoreCommissionPolicyUnavailable = errors.New("partner store commission policy is unavailable")
var ErrPartnerStoreCommissionPolicyConflict = errors.New("partner store commission policy does not match its immutable initialization")
var ErrPartnerCommissionSnapshotMissing = errors.New("customer payment allocation has no commission policy snapshot")
var ErrPartnerStoreCommissionPolicyVersionConflict = errors.New("partner store commission policy version is stale")
var ErrPartnerStoreCommissionPolicyInvalidInput = errors.New("partner store commission policy update is invalid")

type PartnerStoreCommissionPolicyRecord struct {
	StoreID           string    `json:"storeId"`
	PartnerActorID    string    `json:"partnerActorId"`
	FulfillmentMode   string    `json:"fulfillmentMode"`
	CommissionRateBps int       `json:"commissionRateBps"`
	PolicyVersion     int       `json:"policyVersion"`
	ProfileID         string    `json:"profileId"`
	SettlementPeriod  string    `json:"settlementPeriod"`
	ProfileVersion    int       `json:"profileVersion"`
	RoundingUnitMinor int64     `json:"roundingUnitMinor"`
	UpdatedAt         time.Time `json:"updatedAt"`
	ChangedByActorID  string    `json:"changedByActorId,omitempty"`
	ChangeReason      string    `json:"changeReason,omitempty"`
}

type PartnerStoreCommissionPolicyUpdate struct {
	StoreID           string
	FulfillmentMode   string
	CommissionRateBps int
	ExpectedVersion   int
	ChangedByActorID  string
	Reason            string
	IdempotencyKey    string
	CorrelationID     string
}

var supportedPartnerStoreCommissionModes = []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"}

func isPartnerStoreCommissionMode(mode string) bool {
	switch strings.TrimSpace(mode) {
	case "BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP":
		return true
	default:
		return false
	}
}

func partnerCommissionFromSnapshot(baseMinor int64, snapshot *PartnerStoreCommissionSnapshot) (int64, error) {
	if snapshot == nil || snapshot.PolicyVersion < 1 || strings.TrimSpace(snapshot.ProfileID) == "" || snapshot.ProfileVersion < 1 || snapshot.RoundingUnitMinor != 50 || (snapshot.SettlementPeriod != "DAILY" && snapshot.SettlementPeriod != "WEEKLY" && snapshot.SettlementPeriod != "MONTHLY") {
		return 0, ErrPartnerCommissionSnapshotMissing
	}
	return roundedCommission(baseMinor, snapshot.RateBps, snapshot.RoundingUnitMinor)
}

func InitializePartnerStoreCommissionPolicies(ctx context.Context, db *sql.DB, storeID, partnerActorID, profileID, idempotencyKey, correlationID string) ([]PartnerStoreCommissionPolicyRecord, error) {
	storeID, partnerActorID, profileID = strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID), strings.TrimSpace(profileID)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || partnerActorID == "" || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 {
		return nil, ErrPartnerStoreCommissionPolicyUnavailable
	}
	requestHash := hashFacts("partner-store-commission-policy-initialize", storeID, partnerActorID, profileID)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-store-commission-policy-init:"+idempotencyKey); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-store-commission-policy-store:"+storeID); err != nil {
		return nil, err
	}
	var existingHash string
	err = tx.QueryRowContext(ctx, `SELECT request_hash FROM wlt.partner_store_commission_policy_initializations WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&existingHash)
	if err == nil {
		if existingHash != requestHash {
			return nil, ErrIdempotencyConflict
		}
		policies, readErr := readPartnerStoreCommissionPolicies(ctx, tx, storeID, partnerActorID)
		if readErr != nil {
			return nil, readErr
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return policies, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var policyCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM wlt.partner_store_commission_policies WHERE store_id=$1`, storeID).Scan(&policyCount); err != nil {
		return nil, err
	}
	var policies []PartnerStoreCommissionPolicyRecord
	resolvedProfileID := ""
	if policyCount == len(supportedPartnerStoreCommissionModes) {
		policies, err = readPartnerStoreCommissionPolicies(ctx, tx, storeID, partnerActorID)
		if err != nil {
			return nil, err
		}
		resolvedProfileID = policies[0].ProfileID
	} else if policyCount == 0 {
		var rateBps, profileVersion int
		var roundingUnit int64
		var settlementPeriod, state string
		query := `SELECT id,commission_rate_bps,version,rounding_unit_minor,settlement_period,state FROM wlt.partner_financial_profiles WHERE partner_actor_id=$1 AND state='ACTIVE' FOR SHARE`
		args := []any{partnerActorID}
		if profileID != "" {
			query = `SELECT id,commission_rate_bps,version,rounding_unit_minor,settlement_period,state FROM wlt.partner_financial_profiles WHERE id=$1 AND partner_actor_id=$2 FOR SHARE`
			args = []any{profileID, partnerActorID}
		}
		var queriedProfileID string
		if err := tx.QueryRowContext(ctx, query, args...).Scan(&queriedProfileID, &rateBps, &profileVersion, &roundingUnit, &settlementPeriod, &state); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrPartnerStoreCommissionPolicyUnavailable
			}
			return nil, err
		}
		if state != "ACTIVE" || rateBps < 0 || rateBps > 10000 || profileVersion < 1 || roundingUnit != 50 || (settlementPeriod != "DAILY" && settlementPeriod != "WEEKLY" && settlementPeriod != "MONTHLY") {
			return nil, ErrPartnerStoreCommissionPolicyUnavailable
		}
		resolvedProfileID = queriedProfileID
		for _, mode := range supportedPartnerStoreCommissionModes {
			if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_store_commission_policies(store_id,partner_actor_id,fulfillment_mode,commission_rate_bps,profile_id,profile_version,rounding_unit_minor,settlement_period)
				VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, storeID, partnerActorID, mode, rateBps, queriedProfileID, profileVersion, roundingUnit, settlementPeriod); err != nil {
				return nil, err
			}
		}
		policies, err = readPartnerStoreCommissionPolicies(ctx, tx, storeID, partnerActorID)
		if err != nil {
			return nil, err
		}
	} else {
		return nil, ErrPartnerStoreCommissionPolicyConflict
	}
	if resolvedProfileID == "" {
		return nil, ErrPartnerStoreCommissionPolicyUnavailable
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_store_commission_policy_initializations(idempotency_key,request_hash,store_id,partner_actor_id,profile_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6)`, idempotencyKey, requestHash, storeID, partnerActorID, resolvedProfileID, correlationID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return policies, nil
}

func ReadPartnerStoreCommissionPolicies(ctx context.Context, db *sql.DB, storeID string) ([]PartnerStoreCommissionPolicyRecord, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || storeID == "" || len(storeID) > 128 {
		return nil, ErrPartnerStoreCommissionPolicyInvalidInput
	}
	return readPartnerStoreCommissionPolicies(ctx, db, storeID, "")
}

func UpdatePartnerStoreCommissionPolicy(ctx context.Context, db *sql.DB, input PartnerStoreCommissionPolicyUpdate) (PartnerStoreCommissionPolicyRecord, bool, error) {
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.FulfillmentMode = strings.TrimSpace(input.FulfillmentMode)
	input.ChangedByActorID = strings.TrimSpace(input.ChangedByActorID)
	input.Reason = strings.TrimSpace(input.Reason)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.StoreID == "" || len(input.StoreID) > 128 || !isPartnerStoreCommissionMode(input.FulfillmentMode) || input.CommissionRateBps < 0 || input.CommissionRateBps > 10000 || input.ExpectedVersion < 1 || input.ChangedByActorID == "" || len(input.ChangedByActorID) > 128 || utf8.RuneCountInString(input.Reason) < 8 || utf8.RuneCountInString(input.Reason) > 500 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PartnerStoreCommissionPolicyRecord{}, false, ErrPartnerStoreCommissionPolicyInvalidInput
	}
	requestHash := hashFacts("partner-store-commission-policy-update-v1", input.StoreID, input.FulfillmentMode, strconv.Itoa(input.CommissionRateBps), strconv.Itoa(input.ExpectedVersion), input.ChangedByActorID, input.Reason)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-store-commission-policy-update:"+input.IdempotencyKey); err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	var previousHash string
	err = tx.QueryRowContext(ctx, `SELECT request_hash FROM wlt.partner_store_commission_policy_events WHERE idempotency_key=$1`, input.IdempotencyKey).Scan(&previousHash)
	if err == nil {
		if previousHash != requestHash {
			return PartnerStoreCommissionPolicyRecord{}, false, ErrIdempotencyConflict
		}
		current, readErr := readPartnerStoreCommissionPolicy(ctx, tx, input.StoreID, input.FulfillmentMode)
		if readErr != nil {
			return PartnerStoreCommissionPolicyRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PartnerStoreCommissionPolicyRecord{}, false, err
		}
		return current, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	current, err := readPartnerStoreCommissionPolicyForUpdate(ctx, tx, input.StoreID, input.FulfillmentMode)
	if err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	if current.PolicyVersion != input.ExpectedVersion {
		return PartnerStoreCommissionPolicyRecord{}, false, ErrPartnerStoreCommissionPolicyVersionConflict
	}
	if input.CommissionRateBps == current.CommissionRateBps {
		return current, false, ErrPartnerStoreCommissionPolicyInvalidInput
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.partner_store_commission_policies
		SET commission_rate_bps=$3,policy_version=policy_version+1,updated_at=clock_timestamp(),last_changed_by_actor_id=$4,last_change_reason=$5
		WHERE store_id=$1 AND fulfillment_mode=$2`, input.StoreID, input.FulfillmentMode, input.CommissionRateBps, input.ChangedByActorID, input.Reason); err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_store_commission_policy_events(
		idempotency_key,request_hash,store_id,partner_actor_id,fulfillment_mode,previous_rate_bps,new_rate_bps,previous_policy_version,new_policy_version,changed_by_actor_id,reason,correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, input.IdempotencyKey, requestHash, current.StoreID, current.PartnerActorID, input.FulfillmentMode, current.CommissionRateBps, input.CommissionRateBps, current.PolicyVersion, current.PolicyVersion+1, input.ChangedByActorID, input.Reason, input.CorrelationID); err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	updated, err := readPartnerStoreCommissionPolicy(ctx, tx, input.StoreID, input.FulfillmentMode)
	if err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	return updated, false, nil
}

func readPartnerStoreCommissionPolicy(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, storeID, fulfillmentMode string) (PartnerStoreCommissionPolicyRecord, error) {
	var item PartnerStoreCommissionPolicyRecord
	var changedBy, reason sql.NullString
	err := source.QueryRowContext(ctx, `SELECT store_id,partner_actor_id,fulfillment_mode,commission_rate_bps,policy_version,profile_id,profile_version,rounding_unit_minor,settlement_period,updated_at,last_changed_by_actor_id,last_change_reason
		FROM wlt.partner_store_commission_policies WHERE store_id=$1 AND fulfillment_mode=$2`, storeID, fulfillmentMode).Scan(
		&item.StoreID, &item.PartnerActorID, &item.FulfillmentMode, &item.CommissionRateBps, &item.PolicyVersion, &item.ProfileID, &item.ProfileVersion, &item.RoundingUnitMinor, &item.SettlementPeriod, &item.UpdatedAt, &changedBy, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerStoreCommissionPolicyRecord{}, ErrPartnerStoreCommissionPolicyUnavailable
	}
	if err != nil {
		return PartnerStoreCommissionPolicyRecord{}, err
	}
	item.ChangedByActorID = changedBy.String
	item.ChangeReason = reason.String
	return item, nil
}

func readPartnerStoreCommissionPolicyForUpdate(ctx context.Context, tx *sql.Tx, storeID, fulfillmentMode string) (PartnerStoreCommissionPolicyRecord, error) {
	var item PartnerStoreCommissionPolicyRecord
	var changedBy, reason sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT store_id,partner_actor_id,fulfillment_mode,commission_rate_bps,policy_version,profile_id,profile_version,rounding_unit_minor,settlement_period,updated_at,last_changed_by_actor_id,last_change_reason
		FROM wlt.partner_store_commission_policies WHERE store_id=$1 AND fulfillment_mode=$2 FOR UPDATE`, storeID, fulfillmentMode).Scan(
		&item.StoreID, &item.PartnerActorID, &item.FulfillmentMode, &item.CommissionRateBps, &item.PolicyVersion, &item.ProfileID, &item.ProfileVersion, &item.RoundingUnitMinor, &item.SettlementPeriod, &item.UpdatedAt, &changedBy, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerStoreCommissionPolicyRecord{}, ErrPartnerStoreCommissionPolicyUnavailable
	}
	if err != nil {
		return PartnerStoreCommissionPolicyRecord{}, err
	}
	item.ChangedByActorID = changedBy.String
	item.ChangeReason = reason.String
	return item, nil
}

func readPartnerStoreCommissionPolicies(ctx context.Context, source interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, storeID, partnerActorID string) ([]PartnerStoreCommissionPolicyRecord, error) {
	rows, err := source.QueryContext(ctx, `SELECT store_id,partner_actor_id,fulfillment_mode,commission_rate_bps,policy_version,profile_id,profile_version,rounding_unit_minor,settlement_period,updated_at,last_changed_by_actor_id,last_change_reason
		FROM wlt.partner_store_commission_policies WHERE store_id=$1 ORDER BY fulfillment_mode`, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	policies := make([]PartnerStoreCommissionPolicyRecord, 0, len(supportedPartnerStoreCommissionModes))
	for rows.Next() {
		var item PartnerStoreCommissionPolicyRecord
		var changedBy, reason sql.NullString
		if err := rows.Scan(&item.StoreID, &item.PartnerActorID, &item.FulfillmentMode, &item.CommissionRateBps, &item.PolicyVersion, &item.ProfileID, &item.ProfileVersion, &item.RoundingUnitMinor, &item.SettlementPeriod, &item.UpdatedAt, &changedBy, &reason); err != nil {
			return nil, err
		}
		if (partnerActorID != "" && item.PartnerActorID != partnerActorID) || (len(policies) > 0 && item.PartnerActorID != policies[0].PartnerActorID) {
			return nil, ErrPartnerStoreCommissionPolicyUnavailable
		}
		item.ChangedByActorID = changedBy.String
		item.ChangeReason = reason.String
		policies = append(policies, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(policies) != len(supportedPartnerStoreCommissionModes) {
		return nil, ErrPartnerStoreCommissionPolicyUnavailable
	}
	return policies, nil
}
