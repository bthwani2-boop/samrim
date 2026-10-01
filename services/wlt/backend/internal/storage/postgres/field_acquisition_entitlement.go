package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrFieldAcquisitionRewardPolicyInvalidInput = errors.New("field acquisition reward policy input is invalid")
	ErrFieldAcquisitionRewardPolicyNotFound     = errors.New("field acquisition reward policy was not found")
	ErrFieldAcquisitionRewardPolicyExists       = errors.New("field acquisition reward policy already exists")
	ErrFieldAcquisitionEntitlementInvalid       = errors.New("field acquisition entitlement input is invalid")
	ErrFieldAcquisitionEntitlementExists        = errors.New("field acquisition entitlement already exists")
)

type CreateFieldAcquisitionRewardPolicyInput struct {
	ScopeType         string
	ScopeID           string
	RewardMinor       int64
	RoundingUnitMinor int64
	CreatedBy         string
	IdempotencyKey    string
	CorrelationID     string
	ExpectedVersion   int
	Reason            string
}

type FieldAcquisitionRewardPolicyRecord struct {
	ID                string
	ScopeType         string
	ScopeID           string
	RewardMinor       int64
	RoundingUnitMinor int64
	State             string
	Version           int
	CreatedBy         string
	CreatedAt         time.Time
	RetiredAt         *time.Time
}

type FinalizeFieldAcquisitionRewardInput struct {
	JoiningCaseID         string
	StoreID               string
	PartnerActorID        string
	FieldActorID          string
	VerticalID            string
	CommercialStoreTypeID string
	IdempotencyKey        string
	CorrelationID         string
}

type FieldAcquisitionEntitlementRecord struct {
	JoiningCaseID         string
	StoreID               string
	PartnerActorID        string
	FieldActorID          string
	VerticalID            string
	CommercialStoreTypeID string
	PolicyID              string
	PolicyVersion         int
	RewardMinor           int64
	Currency              string
	LedgerTransactionID   string
	CreatedAt             time.Time
}

type FieldFinancialSummaryRecord struct {
	FieldActorID     string
	Currency         string
	EarnedMinor      int64
	EntitlementMinor int64
	PartnerCount     int64
	LastEarningAt    *time.Time
}

func HashCreateFieldAcquisitionRewardPolicy(input CreateFieldAcquisitionRewardPolicyInput) string {
	return hashFacts("field-acquisition-reward-policy", strings.ToUpper(strings.TrimSpace(input.ScopeType)), strings.TrimSpace(input.ScopeID), formatInt64(input.RewardMinor), formatInt64(input.RoundingUnitMinor), formatInt64(int64(input.ExpectedVersion)), strings.TrimSpace(input.Reason))
}

func HashFinalizeFieldAcquisitionReward(input FinalizeFieldAcquisitionRewardInput) string {
	return hashFacts("field-acquisition-entitlement", strings.TrimSpace(input.JoiningCaseID), strings.TrimSpace(input.FieldActorID), strings.TrimSpace(input.PartnerActorID), strings.TrimSpace(input.VerticalID), strings.TrimSpace(input.CommercialStoreTypeID))
}

func CreateFieldAcquisitionRewardPolicy(ctx context.Context, db *sql.DB, input CreateFieldAcquisitionRewardPolicyInput) (FieldAcquisitionRewardPolicyRecord, bool, error) {
	input.ScopeType = strings.ToUpper(strings.TrimSpace(input.ScopeType))
	input.ScopeID = strings.TrimSpace(input.ScopeID)
	input.CreatedBy = strings.TrimSpace(input.CreatedBy)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.Reason = strings.Join(strings.Fields(strings.TrimSpace(input.Reason)), " ")
	if db == nil || input.ScopeType != "STORE_TYPE" || boundedText(input.ScopeID, 1, 128) == "" || input.RewardMinor <= 0 || input.RoundingUnitMinor != 50 || input.ExpectedVersion < 0 || len(input.Reason) < 5 || len(input.Reason) > 500 || boundedText(input.CreatedBy, 1, 128) == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return FieldAcquisitionRewardPolicyRecord{}, false, ErrFieldAcquisitionRewardPolicyInvalidInput
	}
	requestHash := HashCreateFieldAcquisitionRewardPolicy(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:field-acquisition-reward-policy:idempotency:"+input.IdempotencyKey); err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:field-acquisition-reward-policy:scope:"+input.ScopeType+":"+input.ScopeID); err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	var existingHash, existingID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,id FROM wlt.field_acquisition_reward_policies WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingHash, &existingID)
	if err == nil {
		if existingHash != requestHash {
			return FieldAcquisitionRewardPolicyRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readFieldAcquisitionRewardPolicy(ctx, tx, existingID)
		if readErr != nil {
			return FieldAcquisitionRewardPolicyRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAcquisitionRewardPolicyRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	var currentVersion int
	err = tx.QueryRowContext(ctx, "SELECT version FROM wlt.field_acquisition_reward_policies WHERE scope_type=$1 AND COALESCE(scope_id,'')=COALESCE(NULLIF($2,''),'') AND state='ACTIVE' FOR UPDATE", input.ScopeType, input.ScopeID).Scan(&currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	if input.ExpectedVersion != currentVersion {
		return FieldAcquisitionRewardPolicyRecord{}, false, ErrVersionConflict
	}
	nextVersion := currentVersion + 1
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.field_acquisition_reward_policies SET state='RETIRED',retired_at=clock_timestamp() WHERE scope_type=$1 AND COALESCE(scope_id,'')=COALESCE(NULLIF($2,''),'') AND state='ACTIVE'", input.ScopeType, input.ScopeID); err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	policyID, err := newID("field_policy")
	if err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.field_acquisition_reward_policies(id,scope_type,scope_id,reward_minor,rounding_unit_minor,state,version,created_by,idempotency_key,request_hash,correlation_id,expected_version,change_reason) VALUES($1,$2,NULLIF($3,''),$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11,$12)`, policyID, input.ScopeType, input.ScopeID, input.RewardMinor, input.RoundingUnitMinor, nextVersion, input.CreatedBy, input.IdempotencyKey, requestHash, input.CorrelationID, input.ExpectedVersion, input.Reason); err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, false, err
	}
	item, err := readFieldAcquisitionRewardPolicy(ctx, db, policyID)
	return item, false, err
}

func ReadActiveFieldAcquisitionRewardPolicyByScope(ctx context.Context, db *sql.DB, scopeType, scopeID string) (FieldAcquisitionRewardPolicyRecord, error) {
	scopeType = strings.ToUpper(strings.TrimSpace(scopeType))
	scopeID = strings.TrimSpace(scopeID)
	if db == nil || scopeType != "STORE_TYPE" || boundedText(scopeID, 1, 128) == "" {
		return FieldAcquisitionRewardPolicyRecord{}, ErrFieldAcquisitionRewardPolicyInvalidInput
	}
	return readActiveFieldAcquisitionRewardPolicyByScope(ctx, db, scopeType, scopeID)
}

func readActiveFieldAcquisitionRewardPolicyByScope(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, scopeType, scopeID string) (FieldAcquisitionRewardPolicyRecord, error) {
	var item FieldAcquisitionRewardPolicyRecord
	var storedScopeID sql.NullString
	var retiredAt sql.NullTime
	err := source.QueryRowContext(ctx, `SELECT id,scope_type,scope_id,reward_minor,rounding_unit_minor,state,version,created_by,created_at,retired_at FROM wlt.field_acquisition_reward_policies WHERE scope_type=$1 AND COALESCE(scope_id,'')=$2 AND state='ACTIVE'`, scopeType, scopeID).Scan(&item.ID, &item.ScopeType, &storedScopeID, &item.RewardMinor, &item.RoundingUnitMinor, &item.State, &item.Version, &item.CreatedBy, &item.CreatedAt, &retiredAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionRewardPolicyRecord{}, ErrFieldAcquisitionRewardPolicyNotFound
	}
	if err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, err
	}
	if storedScopeID.Valid {
		item.ScopeID = storedScopeID.String
	}
	if retiredAt.Valid {
		item.RetiredAt = &retiredAt.Time
	}
	return item, nil
}

func readFieldAcquisitionRewardPolicy(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, policyID string) (FieldAcquisitionRewardPolicyRecord, error) {
	var item FieldAcquisitionRewardPolicyRecord
	var scopeID sql.NullString
	var retiredAt sql.NullTime
	err := source.QueryRowContext(ctx, `SELECT id,scope_type,scope_id,reward_minor,rounding_unit_minor,state,version,created_by,created_at,retired_at FROM wlt.field_acquisition_reward_policies WHERE id=$1`, policyID).Scan(&item.ID, &item.ScopeType, &scopeID, &item.RewardMinor, &item.RoundingUnitMinor, &item.State, &item.Version, &item.CreatedBy, &item.CreatedAt, &retiredAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionRewardPolicyRecord{}, ErrFieldAcquisitionRewardPolicyNotFound
	}
	if err != nil {
		return FieldAcquisitionRewardPolicyRecord{}, err
	}
	if scopeID.Valid {
		item.ScopeID = scopeID.String
	}
	if retiredAt.Valid {
		item.RetiredAt = &retiredAt.Time
	}
	return item, nil
}

func FinalizeFieldAcquisitionReward(ctx context.Context, db *sql.DB, input FinalizeFieldAcquisitionRewardInput) (FieldAcquisitionEntitlementRecord, bool, error) {
	input.JoiningCaseID = strings.TrimSpace(input.JoiningCaseID)
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	input.FieldActorID = strings.TrimSpace(input.FieldActorID)
	input.VerticalID = strings.TrimSpace(input.VerticalID)
	input.CommercialStoreTypeID = strings.TrimSpace(input.CommercialStoreTypeID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.JoiningCaseID, 1, 128) == "" || boundedText(input.StoreID, 1, 128) == "" || boundedText(input.PartnerActorID, 1, 128) == "" || boundedText(input.FieldActorID, 1, 128) == "" || boundedText(input.VerticalID, 1, 128) == "" || boundedText(input.CommercialStoreTypeID, 1, 128) == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return FieldAcquisitionEntitlementRecord{}, false, ErrFieldAcquisitionEntitlementInvalid
	}
	requestHash := HashFinalizeFieldAcquisitionReward(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:field-acquisition:joining-case:"+input.JoiningCaseID); err != nil {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	var existingHash, existingJoiningCase string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,COALESCE(joining_case_id,'') FROM wlt.field_acquisition_entitlements WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingHash, &existingJoiningCase)
	if err == nil {
		if existingHash != requestHash || (existingJoiningCase != "" && existingJoiningCase != input.JoiningCaseID) {
			return FieldAcquisitionEntitlementRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readFieldAcquisitionEntitlementByJoiningCase(ctx, tx, input.JoiningCaseID)
		if readErr != nil {
			return FieldAcquisitionEntitlementRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAcquisitionEntitlementRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	var existingEarningHash string
	err = tx.QueryRowContext(ctx, "SELECT request_hash FROM wlt.field_acquisition_entitlements WHERE joining_case_id=$1 FOR UPDATE", input.JoiningCaseID).Scan(&existingEarningHash)
	if err == nil {
		if existingEarningHash == requestHash {
			item, readErr := readFieldAcquisitionEntitlementByJoiningCase(ctx, tx, input.JoiningCaseID)
			if readErr != nil {
				return FieldAcquisitionEntitlementRecord{}, false, readErr
			}
			if err := tx.Commit(); err != nil {
				return FieldAcquisitionEntitlementRecord{}, false, err
			}
			return item, true, nil
		}
		return FieldAcquisitionEntitlementRecord{}, false, ErrIdempotencyConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	var policy FieldAcquisitionRewardPolicyRecord
	var scopeID sql.NullString
	var retiredAt sql.NullTime
	if err := tx.QueryRowContext(ctx, `SELECT id,scope_type,scope_id,reward_minor,rounding_unit_minor,state,version,created_by,created_at,retired_at FROM wlt.field_acquisition_reward_policies WHERE state='ACTIVE' AND scope_type='STORE_TYPE' AND scope_id=$1 FOR SHARE`, input.CommercialStoreTypeID).Scan(&policy.ID, &policy.ScopeType, &scopeID, &policy.RewardMinor, &policy.RoundingUnitMinor, &policy.State, &policy.Version, &policy.CreatedBy, &policy.CreatedAt, &retiredAt); errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionEntitlementRecord{}, false, ErrFieldAcquisitionRewardPolicyNotFound
	} else if err != nil {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	if scopeID.Valid {
		policy.ScopeID = scopeID.String
	}
	transactionID, err := newID("ledger")
	if err != nil {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'FIELD_ACQUISITION_ENTITLEMENT_POSTED','PARTNER_STORE_CLIENT_VISIBLE',$2,'YER',$3,$4,$5)`, transactionID, input.JoiningCaseID, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'expense','FIELD_ACQUISITION_REWARD_EXPENSE',NULL,NULL,'DEBIT',$2,'YER'),($1,2,'liability','FIELD_WALLET','field',$3,'CREDIT',$2,'YER')`, transactionID, policy.RewardMinor, input.FieldActorID); err != nil {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.field_acquisition_entitlements(joining_case_id,store_id,partner_actor_id,field_actor_id,vertical_id,commercial_store_type_id,policy_id,policy_version,reward_minor,ledger_transaction_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, input.JoiningCaseID, input.StoreID, input.PartnerActorID, input.FieldActorID, input.VerticalID, input.CommercialStoreTypeID, policy.ID, policy.Version, policy.RewardMinor, transactionID, input.IdempotencyKey, requestHash); err != nil {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAcquisitionEntitlementRecord{}, false, err
	}
	item, err := ReadFieldAcquisitionEntitlementByJoiningCase(ctx, db, input.JoiningCaseID)
	return item, false, err
}

func ReadFieldAcquisitionEntitlement(ctx context.Context, db *sql.DB, storeID string) (FieldAcquisitionEntitlementRecord, error) {
	if db == nil || boundedText(strings.TrimSpace(storeID), 1, 128) == "" {
		return FieldAcquisitionEntitlementRecord{}, ErrFieldAcquisitionEntitlementInvalid
	}
	return readFieldAcquisitionEntitlement(ctx, db, strings.TrimSpace(storeID))
}

func readFieldAcquisitionEntitlement(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, storeID string) (FieldAcquisitionEntitlementRecord, error) {
	var item FieldAcquisitionEntitlementRecord
	err := source.QueryRowContext(ctx, `SELECT COALESCE(joining_case_id,''),store_id,COALESCE(partner_actor_id,''),field_actor_id,vertical_id,COALESCE(commercial_store_type_id,''),policy_id,policy_version,reward_minor,currency,ledger_transaction_id,created_at FROM wlt.field_acquisition_entitlements WHERE store_id=$1`, storeID).Scan(&item.JoiningCaseID, &item.StoreID, &item.PartnerActorID, &item.FieldActorID, &item.VerticalID, &item.CommercialStoreTypeID, &item.PolicyID, &item.PolicyVersion, &item.RewardMinor, &item.Currency, &item.LedgerTransactionID, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionEntitlementRecord{}, ErrFieldAcquisitionEntitlementInvalid
	}
	return item, err
}

func ReadFieldAcquisitionEntitlementByJoiningCase(ctx context.Context, db *sql.DB, joiningCaseID string) (FieldAcquisitionEntitlementRecord, error) {
	joiningCaseID = strings.TrimSpace(joiningCaseID)
	if db == nil || boundedText(joiningCaseID, 1, 128) == "" {
		return FieldAcquisitionEntitlementRecord{}, ErrFieldAcquisitionEntitlementInvalid
	}
	return readFieldAcquisitionEntitlementByJoiningCase(ctx, db, joiningCaseID)
}

func readFieldAcquisitionEntitlementByJoiningCase(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, joiningCaseID string) (FieldAcquisitionEntitlementRecord, error) {
	var item FieldAcquisitionEntitlementRecord
	err := source.QueryRowContext(ctx, `SELECT joining_case_id,store_id,partner_actor_id,field_actor_id,vertical_id,COALESCE(commercial_store_type_id,''),policy_id,policy_version,reward_minor,currency,ledger_transaction_id,created_at FROM wlt.field_acquisition_entitlements WHERE joining_case_id=$1`, joiningCaseID).Scan(&item.JoiningCaseID, &item.StoreID, &item.PartnerActorID, &item.FieldActorID, &item.VerticalID, &item.CommercialStoreTypeID, &item.PolicyID, &item.PolicyVersion, &item.RewardMinor, &item.Currency, &item.LedgerTransactionID, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldAcquisitionEntitlementRecord{}, ErrFieldAcquisitionEntitlementInvalid
	}
	return item, err
}

func ReadFieldFinancialSummary(ctx context.Context, db *sql.DB, fieldActorID string) (FieldFinancialSummaryRecord, error) {
	fieldActorID = strings.TrimSpace(fieldActorID)
	if db == nil || boundedText(fieldActorID, 1, 128) == "" {
		return FieldFinancialSummaryRecord{}, ErrFieldAcquisitionEntitlementInvalid
	}
	var result FieldFinancialSummaryRecord
	result.FieldActorID = fieldActorID
	result.Currency = "YER"
	err := db.QueryRowContext(ctx, `SELECT COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='CREDIT'),0),COALESCE(SUM(earning.reward_minor),0),COUNT(DISTINCT COALESCE(earning.joining_case_id,'legacy-store:'||earning.store_id)),MAX(earning.created_at) FROM wlt.field_acquisition_entitlements earning JOIN wlt.ledger_entries e ON e.transaction_id=earning.ledger_transaction_id AND e.account_code='FIELD_WALLET' AND e.actor_id=earning.field_actor_id WHERE earning.field_actor_id=$1`, fieldActorID).Scan(&result.EarnedMinor, &result.EntitlementMinor, &result.PartnerCount, &result.LastEarningAt)
	return result, err
}
