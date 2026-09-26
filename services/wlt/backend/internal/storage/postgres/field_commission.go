package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrFieldCommissionPolicyInvalidInput = errors.New("field commission policy input is invalid")
	ErrFieldCommissionPolicyNotFound     = errors.New("field commission policy was not found")
	ErrFieldCommissionPolicyExists       = errors.New("field commission policy already exists")
	ErrFieldCommissionEarningInvalid     = errors.New("field commission earning input is invalid")
	ErrFieldCommissionEarningExists      = errors.New("field commission earning already exists")
)

type CreateFieldCommissionPolicyInput struct {
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

type FieldCommissionPolicyRecord struct {
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

type FinalizeFieldCommissionInput struct {
	StoreID        string
	FieldActorID   string
	VerticalID     string
	IdempotencyKey string
	CorrelationID  string
}

type FieldCommissionEarningRecord struct {
	StoreID             string
	FieldActorID        string
	VerticalID          string
	PolicyID            string
	PolicyVersion       int
	RewardMinor         int64
	Currency            string
	LedgerTransactionID string
	CreatedAt           time.Time
}

type FieldFinancialSummaryRecord struct {
	FieldActorID    string
	Currency        string
	EarnedMinor     int64
	CommissionMinor int64
	StoreCount      int64
	LastEarningAt   *time.Time
}

func HashCreateFieldCommissionPolicy(input CreateFieldCommissionPolicyInput) string {
	return hashFacts("field-commission-policy", strings.ToUpper(strings.TrimSpace(input.ScopeType)), strings.TrimSpace(input.ScopeID), formatInt64(input.RewardMinor), formatInt64(input.RoundingUnitMinor), formatInt64(int64(input.ExpectedVersion)), strings.TrimSpace(input.Reason))
}

func HashFinalizeFieldCommission(input FinalizeFieldCommissionInput) string {
	return hashFacts("field-commission-finalize", strings.TrimSpace(input.StoreID), strings.TrimSpace(input.FieldActorID), strings.TrimSpace(input.VerticalID))
}

func CreateFieldCommissionPolicy(ctx context.Context, db *sql.DB, input CreateFieldCommissionPolicyInput) (FieldCommissionPolicyRecord, bool, error) {
	input.ScopeType = strings.ToUpper(strings.TrimSpace(input.ScopeType))
	input.ScopeID = strings.TrimSpace(input.ScopeID)
	input.CreatedBy = strings.TrimSpace(input.CreatedBy)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.Reason = strings.Join(strings.Fields(strings.TrimSpace(input.Reason)), " ")
	if db == nil || (input.ScopeType != "DEFAULT" && input.ScopeType != "VERTICAL" && input.ScopeType != "STORE") || (input.ScopeType == "DEFAULT" && input.ScopeID != "") || (input.ScopeType != "DEFAULT" && boundedText(input.ScopeID, 1, 128) == "") || input.RewardMinor <= 0 || input.RoundingUnitMinor != 50 || input.ExpectedVersion < 0 || len(input.Reason) < 5 || len(input.Reason) > 500 || boundedText(input.CreatedBy, 1, 128) == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return FieldCommissionPolicyRecord{}, false, ErrFieldCommissionPolicyInvalidInput
	}
	requestHash := HashCreateFieldCommissionPolicy(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldCommissionPolicyRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:field-commission-policy:idempotency:"+input.IdempotencyKey); err != nil {
		return FieldCommissionPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:field-commission-policy:scope:"+input.ScopeType+":"+input.ScopeID); err != nil {
		return FieldCommissionPolicyRecord{}, false, err
	}
	var existingHash, existingID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,id FROM wlt.field_commission_policies WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingHash, &existingID)
	if err == nil {
		if existingHash != requestHash {
			return FieldCommissionPolicyRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readFieldCommissionPolicy(ctx, tx, existingID)
		if readErr != nil {
			return FieldCommissionPolicyRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldCommissionPolicyRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldCommissionPolicyRecord{}, false, err
	}
	var currentVersion int
	err = tx.QueryRowContext(ctx, "SELECT version FROM wlt.field_commission_policies WHERE scope_type=$1 AND COALESCE(scope_id,'')=COALESCE(NULLIF($2,''),'') AND state='ACTIVE' FOR UPDATE", input.ScopeType, input.ScopeID).Scan(&currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return FieldCommissionPolicyRecord{}, false, err
	}
	if input.ExpectedVersion != currentVersion {
		return FieldCommissionPolicyRecord{}, false, ErrVersionConflict
	}
	nextVersion := currentVersion + 1
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.field_commission_policies SET state='RETIRED',retired_at=clock_timestamp() WHERE scope_type=$1 AND COALESCE(scope_id,'')=COALESCE(NULLIF($2,''),'') AND state='ACTIVE'", input.ScopeType, input.ScopeID); err != nil {
		return FieldCommissionPolicyRecord{}, false, err
	}
	policyID, err := newID("field_policy")
	if err != nil {
		return FieldCommissionPolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.field_commission_policies(id,scope_type,scope_id,reward_minor,rounding_unit_minor,state,version,created_by,idempotency_key,request_hash,correlation_id,expected_version,change_reason) VALUES($1,$2,NULLIF($3,''),$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11,$12)`, policyID, input.ScopeType, input.ScopeID, input.RewardMinor, input.RoundingUnitMinor, nextVersion, input.CreatedBy, input.IdempotencyKey, requestHash, input.CorrelationID, input.ExpectedVersion, input.Reason); err != nil {
		return FieldCommissionPolicyRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldCommissionPolicyRecord{}, false, err
	}
	item, err := ReadFieldCommissionPolicy(ctx, db, policyID)
	return item, false, err
}

func ReadFieldCommissionPolicy(ctx context.Context, db *sql.DB, policyID string) (FieldCommissionPolicyRecord, error) {
	if db == nil || boundedText(strings.TrimSpace(policyID), 1, 128) == "" {
		return FieldCommissionPolicyRecord{}, ErrFieldCommissionPolicyInvalidInput
	}
	return readFieldCommissionPolicy(ctx, db, strings.TrimSpace(policyID))
}

func ReadActiveFieldCommissionPolicyByScope(ctx context.Context, db *sql.DB, scopeType, scopeID string) (FieldCommissionPolicyRecord, error) {
	scopeType = strings.ToUpper(strings.TrimSpace(scopeType))
	scopeID = strings.TrimSpace(scopeID)
	if db == nil || (scopeType != "DEFAULT" && scopeType != "VERTICAL" && scopeType != "STORE") || (scopeType == "DEFAULT" && scopeID != "") || (scopeType != "DEFAULT" && boundedText(scopeID, 1, 128) == "") {
		return FieldCommissionPolicyRecord{}, ErrFieldCommissionPolicyInvalidInput
	}
	return readActiveFieldCommissionPolicyByScope(ctx, db, scopeType, scopeID)
}

func readActiveFieldCommissionPolicyByScope(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, scopeType, scopeID string) (FieldCommissionPolicyRecord, error) {
	var item FieldCommissionPolicyRecord
	var storedScopeID sql.NullString
	var retiredAt sql.NullTime
	err := source.QueryRowContext(ctx, `SELECT id,scope_type,scope_id,reward_minor,rounding_unit_minor,state,version,created_by,created_at,retired_at FROM wlt.field_commission_policies WHERE scope_type=$1 AND COALESCE(scope_id,'')=$2 AND state='ACTIVE'`, scopeType, scopeID).Scan(&item.ID, &item.ScopeType, &storedScopeID, &item.RewardMinor, &item.RoundingUnitMinor, &item.State, &item.Version, &item.CreatedBy, &item.CreatedAt, &retiredAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldCommissionPolicyRecord{}, ErrFieldCommissionPolicyNotFound
	}
	if err != nil {
		return FieldCommissionPolicyRecord{}, err
	}
	if storedScopeID.Valid {
		item.ScopeID = storedScopeID.String
	}
	if retiredAt.Valid {
		item.RetiredAt = &retiredAt.Time
	}
	return item, nil
}

func readFieldCommissionPolicy(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, policyID string) (FieldCommissionPolicyRecord, error) {
	var item FieldCommissionPolicyRecord
	var scopeID sql.NullString
	var retiredAt sql.NullTime
	err := source.QueryRowContext(ctx, `SELECT id,scope_type,scope_id,reward_minor,rounding_unit_minor,state,version,created_by,created_at,retired_at FROM wlt.field_commission_policies WHERE id=$1`, policyID).Scan(&item.ID, &item.ScopeType, &scopeID, &item.RewardMinor, &item.RoundingUnitMinor, &item.State, &item.Version, &item.CreatedBy, &item.CreatedAt, &retiredAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldCommissionPolicyRecord{}, ErrFieldCommissionPolicyNotFound
	}
	if err != nil {
		return FieldCommissionPolicyRecord{}, err
	}
	if scopeID.Valid {
		item.ScopeID = scopeID.String
	}
	if retiredAt.Valid {
		value := retiredAt.Time
		item.RetiredAt = &value
	}
	return item, nil
}

func FinalizeFieldCommission(ctx context.Context, db *sql.DB, input FinalizeFieldCommissionInput) (FieldCommissionEarningRecord, bool, error) {
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.FieldActorID = strings.TrimSpace(input.FieldActorID)
	input.VerticalID = strings.TrimSpace(input.VerticalID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.StoreID, 1, 128) == "" || boundedText(input.FieldActorID, 1, 128) == "" || boundedText(input.VerticalID, 1, 128) == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return FieldCommissionEarningRecord{}, false, ErrFieldCommissionEarningInvalid
	}
	requestHash := HashFinalizeFieldCommission(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldCommissionEarningRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:field-commission:store:"+input.StoreID); err != nil {
		return FieldCommissionEarningRecord{}, false, err
	}
	var existingHash, existingStore string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,store_id FROM wlt.field_commission_earnings WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingHash, &existingStore)
	if err == nil {
		if existingHash != requestHash || existingStore != input.StoreID {
			return FieldCommissionEarningRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readFieldCommissionEarning(ctx, tx, input.StoreID)
		if readErr != nil {
			return FieldCommissionEarningRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldCommissionEarningRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldCommissionEarningRecord{}, false, err
	}
	var existingEarningHash string
	err = tx.QueryRowContext(ctx, "SELECT request_hash FROM wlt.field_commission_earnings WHERE store_id=$1 FOR UPDATE", input.StoreID).Scan(&existingEarningHash)
	if err == nil {
		if existingEarningHash == requestHash {
			return FieldCommissionEarningRecord{}, false, ErrFieldCommissionEarningExists
		}
		return FieldCommissionEarningRecord{}, false, ErrIdempotencyConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldCommissionEarningRecord{}, false, err
	}
	var policy FieldCommissionPolicyRecord
	var scopeID sql.NullString
	var retiredAt sql.NullTime
	if err := tx.QueryRowContext(ctx, `SELECT id,scope_type,scope_id,reward_minor,rounding_unit_minor,state,version,created_by,created_at,retired_at FROM wlt.field_commission_policies WHERE state='ACTIVE' AND ((scope_type='STORE' AND scope_id=$1) OR (scope_type='VERTICAL' AND scope_id=$2) OR scope_type='DEFAULT') ORDER BY CASE WHEN scope_type='STORE' THEN 1 WHEN scope_type='VERTICAL' THEN 2 ELSE 3 END LIMIT 1 FOR SHARE`, input.StoreID, input.VerticalID).Scan(&policy.ID, &policy.ScopeType, &scopeID, &policy.RewardMinor, &policy.RoundingUnitMinor, &policy.State, &policy.Version, &policy.CreatedBy, &policy.CreatedAt, &retiredAt); errors.Is(err, sql.ErrNoRows) {
		return FieldCommissionEarningRecord{}, false, ErrFieldCommissionPolicyNotFound
	} else if err != nil {
		return FieldCommissionEarningRecord{}, false, err
	}
	if scopeID.Valid {
		policy.ScopeID = scopeID.String
	}
	transactionID, err := newID("ledger")
	if err != nil {
		return FieldCommissionEarningRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'FIELD_COMMISSION_EARNING_POSTED','STORE_CLIENT_VISIBLE',$2,'YER',$3,$4,$5)`, transactionID, input.StoreID, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return FieldCommissionEarningRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'expense','FIELD_COMMISSION_EXPENSE',NULL,NULL,'DEBIT',$2,'YER'),($1,2,'liability','FIELD_WALLET','field',$3,'CREDIT',$2,'YER')`, transactionID, policy.RewardMinor, input.FieldActorID); err != nil {
		return FieldCommissionEarningRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.field_commission_earnings(store_id,field_actor_id,vertical_id,policy_id,policy_version,reward_minor,ledger_transaction_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, input.StoreID, input.FieldActorID, input.VerticalID, policy.ID, policy.Version, policy.RewardMinor, transactionID, input.IdempotencyKey, requestHash); err != nil {
		return FieldCommissionEarningRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldCommissionEarningRecord{}, false, err
	}
	item, err := ReadFieldCommissionEarning(ctx, db, input.StoreID)
	return item, false, err
}

func ReadFieldCommissionEarning(ctx context.Context, db *sql.DB, storeID string) (FieldCommissionEarningRecord, error) {
	if db == nil || boundedText(strings.TrimSpace(storeID), 1, 128) == "" {
		return FieldCommissionEarningRecord{}, ErrFieldCommissionEarningInvalid
	}
	return readFieldCommissionEarning(ctx, db, strings.TrimSpace(storeID))
}

func readFieldCommissionEarning(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, storeID string) (FieldCommissionEarningRecord, error) {
	var item FieldCommissionEarningRecord
	err := source.QueryRowContext(ctx, `SELECT store_id,field_actor_id,vertical_id,policy_id,policy_version,reward_minor,currency,ledger_transaction_id,created_at FROM wlt.field_commission_earnings WHERE store_id=$1`, storeID).Scan(&item.StoreID, &item.FieldActorID, &item.VerticalID, &item.PolicyID, &item.PolicyVersion, &item.RewardMinor, &item.Currency, &item.LedgerTransactionID, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldCommissionEarningRecord{}, ErrFieldCommissionEarningInvalid
	}
	return item, err
}

func ReadFieldFinancialSummary(ctx context.Context, db *sql.DB, fieldActorID string) (FieldFinancialSummaryRecord, error) {
	fieldActorID = strings.TrimSpace(fieldActorID)
	if db == nil || boundedText(fieldActorID, 1, 128) == "" {
		return FieldFinancialSummaryRecord{}, ErrFieldCommissionEarningInvalid
	}
	var result FieldFinancialSummaryRecord
	result.FieldActorID = fieldActorID
	result.Currency = "YER"
	err := db.QueryRowContext(ctx, `SELECT COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='CREDIT'),0),COALESCE(SUM(earning.reward_minor),0),COUNT(DISTINCT earning.store_id),MAX(earning.created_at) FROM wlt.field_commission_earnings earning JOIN wlt.ledger_entries e ON e.transaction_id=earning.ledger_transaction_id AND e.account_code='FIELD_WALLET' AND e.actor_id=earning.field_actor_id WHERE earning.field_actor_id=$1`, fieldActorID).Scan(&result.EarnedMinor, &result.CommissionMinor, &result.StoreCount, &result.LastEarningAt)
	return result, err
}
