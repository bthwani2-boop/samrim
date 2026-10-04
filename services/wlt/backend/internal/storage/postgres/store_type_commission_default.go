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

var ErrStoreTypeCommissionDefaultUnavailable = errors.New("commercial store type commission suggestion is unavailable")
var ErrStoreTypeCommissionDefaultVersionConflict = errors.New("commercial store type commission suggestion version is stale")
var ErrStoreTypeCommissionDefaultInvalidInput = errors.New("commercial store type commission suggestion update is invalid")
var ErrPartnerCommissionSnapshotMissing = errors.New("customer payment allocation has no immutable commission snapshot")

type StoreTypeCommissionDefaultRecord struct {
	CommercialStoreTypeID string    `json:"commercialStoreTypeId"`
	FulfillmentMode       string    `json:"fulfillmentMode"`
	CommissionRateBps     int       `json:"suggestedCommissionRateBps"`
	PolicyVersion         int       `json:"defaultVersion"`
	UpdatedAt             time.Time `json:"updatedAt"`
	ChangedByActorID      string    `json:"changedByActorId,omitempty"`
	ChangeReason          string    `json:"changeReason,omitempty"`
}

type StoreTypeCommissionDefaultUpdate struct {
	CommercialStoreTypeID string
	FulfillmentMode       string
	CommissionRateBps     int
	ExpectedVersion       int
	ChangedByActorID      string
	Reason                string
	IdempotencyKey        string
	CorrelationID         string
}

var supportedStoreTypeCommissionModes = []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"}

func isStoreTypeCommissionMode(mode string) bool {
	switch strings.TrimSpace(mode) {
	case "BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP":
		return true
	default:
		return false
	}
}

func partnerCommissionFromSnapshot(baseMinor int64, snapshot *PartnerStoreCommissionSnapshot) (int64, error) {
	if snapshot == nil || strings.TrimSpace(snapshot.ProfileID) == "" || snapshot.ProfileVersion < 1 || snapshot.RoundingUnitMinor != 50 || (snapshot.SettlementPeriod != "DAILY" && snapshot.SettlementPeriod != "WEEKLY" && snapshot.SettlementPeriod != "MONTHLY") {
		return 0, ErrPartnerCommissionSnapshotMissing
	}
	if snapshot.Source == "STORE_AGREEMENT" {
		if snapshot.AgreementID == "" || snapshot.AgreementVersion < 1 || !isStoreTypeCommissionMode(snapshot.FulfillmentMode) || snapshot.CalculationBasis != "SUBTOTAL_MINUS_DISCOUNT" || snapshot.RateBps < 0 || snapshot.RateBps > 10000 {
			return 0, ErrPartnerCommissionSnapshotMissing
		}
	} else if snapshot.Source == "LEGACY_PRE_AGREEMENT" || snapshot.Source == "" {
		if snapshot.PolicyVersion < 1 || snapshot.RateBps < 0 || snapshot.RateBps > 10000 {
			return 0, ErrPartnerCommissionSnapshotMissing
		}
	} else {
		return 0, ErrPartnerCommissionSnapshotMissing
	}
	return roundedCommission(baseMinor, snapshot.RateBps, snapshot.RoundingUnitMinor)
}

func storeAgreementSnapshotPolicyVersion(snapshot PartnerStoreCommissionSnapshot) string {
	if snapshot.Source != "STORE_AGREEMENT" {
		return "legacy-pre-agreement-v1;type=" + snapshot.CommercialStoreTypeID + ";mode=" + snapshot.FulfillmentMode + ";policy=" + formatInt(snapshot.PolicyVersion) + ";rate-bps=" + formatInt(snapshot.RateBps) + ";profile=" + snapshot.ProfileID + ":" + formatInt(snapshot.ProfileVersion) + ";rounding=" + formatInt64(snapshot.RoundingUnitMinor) + ";settlement=" + snapshot.SettlementPeriod
	}
	return "store-agreement-v1;agreement=" + snapshot.AgreementID + ":" + formatInt(snapshot.AgreementVersion) + ";mode=" + snapshot.FulfillmentMode + ";rate-bps=" + formatInt(snapshot.RateBps) + ";basis=" + snapshot.CalculationBasis + ";profile=" + snapshot.ProfileID + ":" + formatInt(snapshot.ProfileVersion) + ";rounding=" + formatInt64(snapshot.RoundingUnitMinor) + ";settlement=" + snapshot.SettlementPeriod
}

func ReadStoreTypeCommissionDefaults(ctx context.Context, db *sql.DB, commercialStoreTypeID string) ([]StoreTypeCommissionDefaultRecord, error) {
	typeID := strings.TrimSpace(commercialStoreTypeID)
	if db == nil || typeID == "" || len(typeID) > 128 {
		return nil, ErrStoreTypeCommissionDefaultInvalidInput
	}
	rows, err := db.QueryContext(ctx, `SELECT commercial_store_type_id,fulfillment_mode,commission_rate_bps,policy_version,updated_at,last_changed_by_actor_id,last_change_reason
		FROM wlt.commercial_store_type_commission_defaults WHERE commercial_store_type_id=$1 ORDER BY fulfillment_mode`, typeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]StoreTypeCommissionDefaultRecord, 0, len(supportedStoreTypeCommissionModes))
	for rows.Next() {
		var item StoreTypeCommissionDefaultRecord
		var actor, reason sql.NullString
		if err := rows.Scan(&item.CommercialStoreTypeID, &item.FulfillmentMode, &item.CommissionRateBps, &item.PolicyVersion, &item.UpdatedAt, &actor, &reason); err != nil {
			return nil, err
		}
		item.ChangedByActorID, item.ChangeReason = actor.String, reason.String
		result = append(result, item)
	}
	return result, rows.Err()
}

func UpdateStoreTypeCommissionDefault(ctx context.Context, db *sql.DB, input StoreTypeCommissionDefaultUpdate) (StoreTypeCommissionDefaultRecord, bool, error) {
	input.CommercialStoreTypeID = strings.TrimSpace(input.CommercialStoreTypeID)
	input.FulfillmentMode = strings.TrimSpace(input.FulfillmentMode)
	input.ChangedByActorID = strings.TrimSpace(input.ChangedByActorID)
	input.Reason = strings.TrimSpace(input.Reason)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.CommercialStoreTypeID == "" || len(input.CommercialStoreTypeID) > 128 || !isStoreTypeCommissionMode(input.FulfillmentMode) || input.CommissionRateBps < 0 || input.CommissionRateBps > 10000 || input.ExpectedVersion < 0 || input.ChangedByActorID == "" || len(input.ChangedByActorID) > 128 || utf8.RuneCountInString(input.Reason) < 8 || utf8.RuneCountInString(input.Reason) > 500 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return StoreTypeCommissionDefaultRecord{}, false, ErrStoreTypeCommissionDefaultInvalidInput
	}
	requestHash := hashFacts("commercial-store-type-commission-default-v1", input.CommercialStoreTypeID, input.FulfillmentMode, strconv.Itoa(input.CommissionRateBps), strconv.Itoa(input.ExpectedVersion), input.ChangedByActorID, input.Reason)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreTypeCommissionDefaultRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:commercial-store-type-commission:"+input.CommercialStoreTypeID+":"+input.FulfillmentMode); err != nil {
		return StoreTypeCommissionDefaultRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:commercial-store-type-commission-idempotency:"+input.IdempotencyKey); err != nil {
		return StoreTypeCommissionDefaultRecord{}, false, err
	}
	var priorHash string
	err = tx.QueryRowContext(ctx, `SELECT request_hash FROM wlt.commercial_store_type_commission_default_events WHERE idempotency_key=$1`, input.IdempotencyKey).Scan(&priorHash)
	if err == nil {
		if priorHash != requestHash {
			return StoreTypeCommissionDefaultRecord{}, false, ErrIdempotencyConflict
		}
		current, readErr := readStoreTypeCommissionDefault(ctx, tx, input.CommercialStoreTypeID, input.FulfillmentMode)
		if readErr != nil {
			return StoreTypeCommissionDefaultRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return StoreTypeCommissionDefaultRecord{}, false, err
		}
		return current, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreTypeCommissionDefaultRecord{}, false, err
	}
	current, readErr := readStoreTypeCommissionDefault(ctx, tx, input.CommercialStoreTypeID, input.FulfillmentMode)
	var previousRate, previousVersion any
	newVersion := 1
	if readErr == nil {
		if current.PolicyVersion != input.ExpectedVersion {
			return StoreTypeCommissionDefaultRecord{}, false, ErrStoreTypeCommissionDefaultVersionConflict
		}
		if current.CommissionRateBps == input.CommissionRateBps {
			return current, false, ErrStoreTypeCommissionDefaultInvalidInput
		}
		previousRate, previousVersion, newVersion = current.CommissionRateBps, current.PolicyVersion, current.PolicyVersion+1
		_, err = tx.ExecContext(ctx, `UPDATE wlt.commercial_store_type_commission_defaults SET commission_rate_bps=$3,policy_version=$4,updated_at=clock_timestamp(),last_changed_by_actor_id=$5,last_change_reason=$6 WHERE commercial_store_type_id=$1 AND fulfillment_mode=$2`, input.CommercialStoreTypeID, input.FulfillmentMode, input.CommissionRateBps, newVersion, input.ChangedByActorID, input.Reason)
	} else if errors.Is(readErr, ErrStoreTypeCommissionDefaultUnavailable) {
		if input.ExpectedVersion != 0 {
			return StoreTypeCommissionDefaultRecord{}, false, ErrStoreTypeCommissionDefaultVersionConflict
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO wlt.commercial_store_type_commission_defaults(commercial_store_type_id,fulfillment_mode,commission_rate_bps,policy_version,last_changed_by_actor_id,last_change_reason) VALUES($1,$2,$3,1,$4,$5)`, input.CommercialStoreTypeID, input.FulfillmentMode, input.CommissionRateBps, input.ChangedByActorID, input.Reason)
	} else {
		return StoreTypeCommissionDefaultRecord{}, false, readErr
	}
	if err != nil {
		return StoreTypeCommissionDefaultRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.commercial_store_type_commission_default_events(idempotency_key,request_hash,commercial_store_type_id,fulfillment_mode,previous_rate_bps,new_rate_bps,previous_policy_version,new_policy_version,changed_by_actor_id,reason,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, input.IdempotencyKey, requestHash, input.CommercialStoreTypeID, input.FulfillmentMode, previousRate, input.CommissionRateBps, previousVersion, newVersion, input.ChangedByActorID, input.Reason, input.CorrelationID); err != nil {
		return StoreTypeCommissionDefaultRecord{}, false, err
	}
	updated, err := readStoreTypeCommissionDefault(ctx, tx, input.CommercialStoreTypeID, input.FulfillmentMode)
	if err != nil {
		return StoreTypeCommissionDefaultRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreTypeCommissionDefaultRecord{}, false, err
	}
	return updated, false, nil
}

func readStoreTypeCommissionDefault(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, typeID, mode string) (StoreTypeCommissionDefaultRecord, error) {
	var item StoreTypeCommissionDefaultRecord
	var actor, reason sql.NullString
	err := source.QueryRowContext(ctx, `SELECT commercial_store_type_id,fulfillment_mode,commission_rate_bps,policy_version,updated_at,last_changed_by_actor_id,last_change_reason FROM wlt.commercial_store_type_commission_defaults WHERE commercial_store_type_id=$1 AND fulfillment_mode=$2`, typeID, mode).Scan(&item.CommercialStoreTypeID, &item.FulfillmentMode, &item.CommissionRateBps, &item.PolicyVersion, &item.UpdatedAt, &actor, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreTypeCommissionDefaultRecord{}, ErrStoreTypeCommissionDefaultUnavailable
	}
	if err != nil {
		return StoreTypeCommissionDefaultRecord{}, err
	}
	item.ChangedByActorID, item.ChangeReason = actor.String, reason.String
	return item, nil
}
