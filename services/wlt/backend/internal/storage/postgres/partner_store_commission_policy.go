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

var ErrPartnerStoreCommissionPolicyUnavailable = errors.New("commercial store type commission policy is unavailable")
var ErrPartnerStoreCommissionPolicyVersionConflict = errors.New("commercial store type commission policy version is stale")
var ErrPartnerStoreCommissionPolicyInvalidInput = errors.New("commercial store type commission policy update is invalid")
var ErrPartnerCommissionSnapshotMissing = errors.New("customer payment allocation has no commission policy snapshot")

type PartnerStoreCommissionPolicyRecord struct {
	CommercialStoreTypeID string    `json:"commercialStoreTypeId"`
	FulfillmentMode       string    `json:"fulfillmentMode"`
	CommissionRateBps     int       `json:"commissionRateBps"`
	PolicyVersion         int       `json:"policyVersion"`
	UpdatedAt             time.Time `json:"updatedAt"`
	ChangedByActorID      string    `json:"changedByActorId,omitempty"`
	ChangeReason          string    `json:"changeReason,omitempty"`
}

type PartnerStoreCommissionPolicyUpdate struct {
	CommercialStoreTypeID string
	FulfillmentMode       string
	CommissionRateBps     int
	ExpectedVersion       int
	ChangedByActorID      string
	Reason                string
	IdempotencyKey        string
	CorrelationID         string
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

func ReadPartnerStoreCommissionPolicies(ctx context.Context, db *sql.DB, commercialStoreTypeID string) ([]PartnerStoreCommissionPolicyRecord, error) {
	typeID := strings.TrimSpace(commercialStoreTypeID)
	if db == nil || typeID == "" || len(typeID) > 128 {
		return nil, ErrPartnerStoreCommissionPolicyInvalidInput
	}
	rows, err := db.QueryContext(ctx, `SELECT commercial_store_type_id,fulfillment_mode,commission_rate_bps,policy_version,updated_at,last_changed_by_actor_id,last_change_reason
		FROM wlt.commercial_store_type_commission_policies WHERE commercial_store_type_id=$1 ORDER BY fulfillment_mode`, typeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]PartnerStoreCommissionPolicyRecord, 0, len(supportedPartnerStoreCommissionModes))
	for rows.Next() {
		var item PartnerStoreCommissionPolicyRecord
		var actor, reason sql.NullString
		if err := rows.Scan(&item.CommercialStoreTypeID, &item.FulfillmentMode, &item.CommissionRateBps, &item.PolicyVersion, &item.UpdatedAt, &actor, &reason); err != nil {
			return nil, err
		}
		item.ChangedByActorID, item.ChangeReason = actor.String, reason.String
		result = append(result, item)
	}
	return result, rows.Err()
}

func UpdatePartnerStoreCommissionPolicy(ctx context.Context, db *sql.DB, input PartnerStoreCommissionPolicyUpdate) (PartnerStoreCommissionPolicyRecord, bool, error) {
	input.CommercialStoreTypeID = strings.TrimSpace(input.CommercialStoreTypeID)
	input.FulfillmentMode = strings.TrimSpace(input.FulfillmentMode)
	input.ChangedByActorID = strings.TrimSpace(input.ChangedByActorID)
	input.Reason = strings.TrimSpace(input.Reason)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.CommercialStoreTypeID == "" || len(input.CommercialStoreTypeID) > 128 || !isPartnerStoreCommissionMode(input.FulfillmentMode) || input.CommissionRateBps < 0 || input.CommissionRateBps > 10000 || input.ExpectedVersion < 0 || input.ChangedByActorID == "" || len(input.ChangedByActorID) > 128 || utf8.RuneCountInString(input.Reason) < 8 || utf8.RuneCountInString(input.Reason) > 500 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PartnerStoreCommissionPolicyRecord{}, false, ErrPartnerStoreCommissionPolicyInvalidInput
	}
	requestHash := hashFacts("commercial-store-type-commission-policy-v1", input.CommercialStoreTypeID, input.FulfillmentMode, strconv.Itoa(input.CommissionRateBps), strconv.Itoa(input.ExpectedVersion), input.ChangedByActorID, input.Reason)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:commercial-store-type-commission:"+input.CommercialStoreTypeID+":"+input.FulfillmentMode); err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:commercial-store-type-commission-idempotency:"+input.IdempotencyKey); err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	var priorHash string
	err = tx.QueryRowContext(ctx, `SELECT request_hash FROM wlt.commercial_store_type_commission_policy_events WHERE idempotency_key=$1`, input.IdempotencyKey).Scan(&priorHash)
	if err == nil {
		if priorHash != requestHash {
			return PartnerStoreCommissionPolicyRecord{}, false, ErrIdempotencyConflict
		}
		current, readErr := readPartnerStoreCommissionPolicy(ctx, tx, input.CommercialStoreTypeID, input.FulfillmentMode)
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
	current, readErr := readPartnerStoreCommissionPolicy(ctx, tx, input.CommercialStoreTypeID, input.FulfillmentMode)
	var previousRate, previousVersion any
	newVersion := 1
	if readErr == nil {
		if current.PolicyVersion != input.ExpectedVersion {
			return PartnerStoreCommissionPolicyRecord{}, false, ErrPartnerStoreCommissionPolicyVersionConflict
		}
		if current.CommissionRateBps == input.CommissionRateBps {
			return current, false, ErrPartnerStoreCommissionPolicyInvalidInput
		}
		previousRate, previousVersion, newVersion = current.CommissionRateBps, current.PolicyVersion, current.PolicyVersion+1
		_, err = tx.ExecContext(ctx, `UPDATE wlt.commercial_store_type_commission_policies SET commission_rate_bps=$3,policy_version=$4,updated_at=clock_timestamp(),last_changed_by_actor_id=$5,last_change_reason=$6 WHERE commercial_store_type_id=$1 AND fulfillment_mode=$2`, input.CommercialStoreTypeID, input.FulfillmentMode, input.CommissionRateBps, newVersion, input.ChangedByActorID, input.Reason)
	} else if errors.Is(readErr, ErrPartnerStoreCommissionPolicyUnavailable) {
		if input.ExpectedVersion != 0 {
			return PartnerStoreCommissionPolicyRecord{}, false, ErrPartnerStoreCommissionPolicyVersionConflict
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO wlt.commercial_store_type_commission_policies(commercial_store_type_id,fulfillment_mode,commission_rate_bps,policy_version,last_changed_by_actor_id,last_change_reason) VALUES($1,$2,$3,1,$4,$5)`, input.CommercialStoreTypeID, input.FulfillmentMode, input.CommissionRateBps, input.ChangedByActorID, input.Reason)
	} else {
		return PartnerStoreCommissionPolicyRecord{}, false, readErr
	}
	if err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.commercial_store_type_commission_policy_events(idempotency_key,request_hash,commercial_store_type_id,fulfillment_mode,previous_rate_bps,new_rate_bps,previous_policy_version,new_policy_version,changed_by_actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, input.IdempotencyKey, requestHash, input.CommercialStoreTypeID, input.FulfillmentMode, previousRate, input.CommissionRateBps, previousVersion, newVersion, input.ChangedByActorID, input.Reason, input.CorrelationID); err != nil {
		return PartnerStoreCommissionPolicyRecord{}, false, err
	}
	updated, err := readPartnerStoreCommissionPolicy(ctx, tx, input.CommercialStoreTypeID, input.FulfillmentMode)
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
}, typeID, mode string) (PartnerStoreCommissionPolicyRecord, error) {
	var item PartnerStoreCommissionPolicyRecord
	var actor, reason sql.NullString
	err := source.QueryRowContext(ctx, `SELECT commercial_store_type_id,fulfillment_mode,commission_rate_bps,policy_version,updated_at,last_changed_by_actor_id,last_change_reason FROM wlt.commercial_store_type_commission_policies WHERE commercial_store_type_id=$1 AND fulfillment_mode=$2`, typeID, mode).Scan(&item.CommercialStoreTypeID, &item.FulfillmentMode, &item.CommissionRateBps, &item.PolicyVersion, &item.UpdatedAt, &actor, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerStoreCommissionPolicyRecord{}, ErrPartnerStoreCommissionPolicyUnavailable
	}
	if err != nil {
		return PartnerStoreCommissionPolicyRecord{}, err
	}
	item.ChangedByActorID, item.ChangeReason = actor.String, reason.String
	return item, nil
}
