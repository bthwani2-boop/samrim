package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

var (
	ErrPartnerPickupCommissionInvalid = errors.New("partner store pickup commission input is invalid")
	ErrPartnerPickupCommissionExists  = errors.New("partner store pickup commission already exists")
	ErrPartnerPickupCommissionState   = errors.New("store pickup payment is not collected by this partner")
	ErrPartnerCommissionReceivable    = errors.New("partner commission receivable is unavailable")
	ErrPartnerRemittanceInvalid       = errors.New("partner commission remittance input is invalid")
	ErrPartnerRemittanceOverpayment   = errors.New("partner commission remittance exceeds the outstanding receivable")
)

type PartnerStorePickupCommissionInput struct {
	OrderID         string
	PaymentIntentID string
	PartnerActorID  string
	IdempotencyKey  string
	CorrelationID   string
}

type PartnerStorePickupCommissionRecord struct {
	OrderID             string
	PaymentIntentID     string
	PartnerActorID      string
	Currency            string
	GrossProductMinor   int64
	CommissionMinor     int64
	ProfileID           string
	ProfileVersion      int
	PolicyVersion       string
	LedgerTransactionID string
	CreatedAt           time.Time
}

type PartnerCommissionRemittanceInput struct {
	PartnerActorID      string
	AmountMinor         int64
	RemittanceReference string
	EvidenceReference   string
	VerifiedBy          string
	IdempotencyKey      string
	CorrelationID       string
}

type PartnerCommissionRemittanceRecord struct {
	ID                  string
	PartnerActorID      string
	AmountMinor         int64
	Currency            string
	RemittanceReference string
	EvidenceReference   string
	VerifiedBy          string
	VerifiedAt          time.Time
	LedgerTransactionID string
	CreatedAt           time.Time
}

func HashPartnerStorePickupCommission(input PartnerStorePickupCommissionInput) string {
	return hashFacts("partner-store-pickup-commission", strings.TrimSpace(input.OrderID), strings.TrimSpace(input.PaymentIntentID), strings.TrimSpace(input.PartnerActorID))
}

func RecordPartnerStorePickupCommission(ctx context.Context, db *sql.DB, input PartnerStorePickupCommissionInput) (PartnerStorePickupCommissionRecord, bool, error) {
	input.OrderID = strings.TrimSpace(input.OrderID)
	input.PaymentIntentID = strings.TrimSpace(input.PaymentIntentID)
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.OrderID == "" || input.PaymentIntentID == "" || input.PartnerActorID == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PartnerStorePickupCommissionRecord{}, false, ErrPartnerPickupCommissionInvalid
	}
	requestHash := HashPartnerStorePickupCommission(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerStorePickupCommissionRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-store-pickup:"+input.OrderID); err != nil {
		return PartnerStorePickupCommissionRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-commission-balance:"+input.PartnerActorID); err != nil {
		return PartnerStorePickupCommissionRecord{}, false, err
	}
	var existingHash, existingOrder string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,order_id FROM wlt.partner_store_pickup_commissions WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingHash, &existingOrder)
	if err == nil {
		if existingHash != requestHash || existingOrder != input.OrderID {
			return PartnerStorePickupCommissionRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readPartnerStorePickupCommission(ctx, tx, input.OrderID)
		if readErr != nil {
			return PartnerStorePickupCommissionRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PartnerStorePickupCommissionRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerStorePickupCommissionRecord{}, false, err
	}
	var existingID string
	if err := tx.QueryRowContext(ctx, "SELECT order_id FROM wlt.partner_store_pickup_commissions WHERE order_id=$1 OR payment_intent_id=$2 FOR UPDATE", input.OrderID, input.PaymentIntentID).Scan(&existingID); err == nil {
		return PartnerStorePickupCommissionRecord{}, false, ErrPartnerPickupCommissionExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return PartnerStorePickupCommissionRecord{}, false, err
	}

	var paymentState, method, currency, allocationCurrency, allocationPolicy string
	var paymentAmount int64
	var collectedBy sql.NullString
	var allocation CustomerPaymentAllocationRecord
	err = tx.QueryRowContext(ctx, `SELECT p.state,p.method,p.amount_minor,p.currency,p.collected_by_actor_id,
		a.id,a.order_id,a.payment_intent_id,a.currency,a.subtotal_minor,a.delivery_fee_minor,a.discount_minor,a.internal_balance_amount_minor,a.cash_amount_minor,a.customer_payable_minor,a.policy_version,a.created_at
		FROM wlt.payment_intents p JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=p.id
		WHERE p.id=$1 FOR UPDATE OF p,a`, input.PaymentIntentID).Scan(&paymentState, &method, &paymentAmount, &currency, &collectedBy,
		&allocation.ID, &allocation.OrderID, &allocation.PaymentIntentID, &allocationCurrency, &allocation.SubtotalMinor, &allocation.DeliveryFeeMinor, &allocation.DiscountMinor, &allocation.InternalBalanceAmountMinor, &allocation.CashAmountMinor, &allocation.CustomerPayableMinor, &allocationPolicy, &allocation.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerStorePickupCommissionRecord{}, false, ErrCustomerPaymentAllocationNotFound
	}
	if err != nil {
		return PartnerStorePickupCommissionRecord{}, false, err
	}
	if paymentState != domain.StateCollected || method != domain.MethodCashAtStore || !collectedBy.Valid || collectedBy.String != input.PartnerActorID || allocation.OrderID != input.OrderID || allocationCurrency != currency || paymentAmount != allocation.CustomerPayableMinor || allocation.DeliveryFeeMinor != 0 || allocation.InternalBalanceAmountMinor != 0 || allocation.CashAmountMinor != allocation.CustomerPayableMinor || allocation.CustomerPayableMinor != allocation.SubtotalMinor-allocation.DiscountMinor {
		return PartnerStorePickupCommissionRecord{}, false, ErrPartnerPickupCommissionState
	}
	chargeableProduct := allocation.SubtotalMinor - allocation.DiscountMinor
	if chargeableProduct < 0 {
		return PartnerStorePickupCommissionRecord{}, false, ErrPartnerPickupCommissionInvalid
	}
	var profileID, settlementPeriod, profileState string
	var commissionRateBps, profileVersion int
	var roundingUnit int64
	err = tx.QueryRowContext(ctx, `SELECT id,commission_rate_bps,settlement_period,rounding_unit_minor,state,version FROM wlt.partner_financial_profiles WHERE partner_actor_id=$1 AND state='ACTIVE' FOR SHARE`, input.PartnerActorID).Scan(&profileID, &commissionRateBps, &settlementPeriod, &roundingUnit, &profileState, &profileVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerStorePickupCommissionRecord{}, false, ErrPartnerEarningProfile
	}
	if err != nil {
		return PartnerStorePickupCommissionRecord{}, false, err
	}
	if profileState != domain.ProfileActive || roundingUnit != 50 {
		return PartnerStorePickupCommissionRecord{}, false, ErrPartnerEarningProfile
	}
	commission, err := roundedCommission(chargeableProduct, commissionRateBps, roundingUnit)
	if err != nil {
		return PartnerStorePickupCommissionRecord{}, false, err
	}

	var ledgerTransactionID *string
	if commission > 0 {
		transactionID, idErr := newID("ledger")
		if idErr != nil {
			return PartnerStorePickupCommissionRecord{}, false, idErr
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'PARTNER_STORE_PICKUP_COMMISSION_ASSESSED','STORE_PICKUP_COMMISSION',$2,$3,$4,$5,$6)`, transactionID, input.OrderID, currency, "ledger-"+input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
			return PartnerStorePickupCommissionRecord{}, false, err
		}
		partnerActorType, partnerActorID := "partner", input.PartnerActorID
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'asset','PARTNER_COMMISSION_RECEIVABLE',$2,$3,'DEBIT',$4,$5),($1,2,'income','PLATFORM_COMMISSION_INCOME',NULL,NULL,'CREDIT',$4,$5)`, transactionID, partnerActorType, partnerActorID, commission, currency); err != nil {
			return PartnerStorePickupCommissionRecord{}, false, err
		}
		ledgerTransactionID = &transactionID
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_store_pickup_commissions(order_id,payment_intent_id,partner_actor_id,currency,gross_product_minor,commission_minor,profile_id,profile_version,policy_version,ledger_transaction_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, input.OrderID, input.PaymentIntentID, input.PartnerActorID, currency, chargeableProduct, commission, profileID, profileVersion, fmt.Sprintf("partner-store-pickup-commission-v1;profile=%s;settlement=%s", profileID, settlementPeriod), ledgerTransactionID, input.IdempotencyKey, requestHash); err != nil {
		return PartnerStorePickupCommissionRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerStorePickupCommissionRecord{}, false, err
	}
	item, err := ReadPartnerStorePickupCommission(ctx, db, input.OrderID)
	return item, false, err
}

func ReadPartnerStorePickupCommission(ctx context.Context, db *sql.DB, orderID string) (PartnerStorePickupCommissionRecord, error) {
	if db == nil || strings.TrimSpace(orderID) == "" {
		return PartnerStorePickupCommissionRecord{}, ErrPartnerPickupCommissionInvalid
	}
	return readPartnerStorePickupCommission(ctx, db, strings.TrimSpace(orderID))
}

func readPartnerStorePickupCommission(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, orderID string) (PartnerStorePickupCommissionRecord, error) {
	var item PartnerStorePickupCommissionRecord
	var ledgerTransactionID sql.NullString
	err := source.QueryRowContext(ctx, `SELECT order_id,payment_intent_id,partner_actor_id,currency,gross_product_minor,commission_minor,profile_id,profile_version,policy_version,ledger_transaction_id,created_at FROM wlt.partner_store_pickup_commissions WHERE order_id=$1`, orderID).Scan(&item.OrderID, &item.PaymentIntentID, &item.PartnerActorID, &item.Currency, &item.GrossProductMinor, &item.CommissionMinor, &item.ProfileID, &item.ProfileVersion, &item.PolicyVersion, &ledgerTransactionID, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerStorePickupCommissionRecord{}, ErrPartnerEarningNotFound
	}
	if err != nil {
		return PartnerStorePickupCommissionRecord{}, err
	}
	if ledgerTransactionID.Valid {
		item.LedgerTransactionID = ledgerTransactionID.String
	}
	return item, nil
}

func ReadPartnerCommissionReceivableBalance(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, partnerActorID string) (int64, error) {
	var balance int64
	err := source.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE -amount_minor END),0) FROM wlt.ledger_entries WHERE account_code='PARTNER_COMMISSION_RECEIVABLE' AND actor_type='partner' AND actor_id=$1`, strings.TrimSpace(partnerActorID)).Scan(&balance)
	if err != nil {
		return 0, err
	}
	if balance < 0 {
		return 0, ErrLedgerUnbalanced
	}
	return balance, nil
}

func HashPartnerCommissionRemittance(input PartnerCommissionRemittanceInput) string {
	return hashFacts("partner-commission-remittance", strings.TrimSpace(input.PartnerActorID), fmt.Sprintf("%d", input.AmountMinor), strings.TrimSpace(input.RemittanceReference), strings.TrimSpace(input.EvidenceReference), strings.TrimSpace(input.VerifiedBy))
}

func RecordPartnerCommissionRemittance(ctx context.Context, db *sql.DB, input PartnerCommissionRemittanceInput) (PartnerCommissionRemittanceRecord, bool, error) {
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	input.RemittanceReference = strings.TrimSpace(input.RemittanceReference)
	input.EvidenceReference = strings.TrimSpace(input.EvidenceReference)
	input.VerifiedBy = strings.TrimSpace(input.VerifiedBy)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.PartnerActorID == "" || input.AmountMinor <= 0 || len(input.RemittanceReference) == 0 || len(input.RemittanceReference) > 128 || len(input.EvidenceReference) == 0 || len(input.EvidenceReference) > 512 || input.VerifiedBy == "" || len(input.VerifiedBy) > 128 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PartnerCommissionRemittanceRecord{}, false, ErrPartnerRemittanceInvalid
	}
	requestHash := HashPartnerCommissionRemittance(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-commission-balance:"+input.PartnerActorID); err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.partner_commission_remittances WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return PartnerCommissionRemittanceRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readPartnerCommissionRemittance(ctx, tx, existingID)
		if readErr != nil {
			return PartnerCommissionRemittanceRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PartnerCommissionRemittanceRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	balance, err := ReadPartnerCommissionReceivableBalance(ctx, tx, input.PartnerActorID)
	if err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	if input.AmountMinor > balance {
		return PartnerCommissionRemittanceRecord{}, false, ErrPartnerRemittanceOverpayment
	}
	remittanceID, err := newID("partner_commission_remit")
	if err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	transactionID, err := newID("ledger")
	if err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'PARTNER_COMMISSION_RECEIVABLE_REMITTED','PARTNER_COMMISSION_REMITTANCE',$2,'YER',$3,$4,$5)`, transactionID, remittanceID, "ledger-"+input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	partnerActorType, partnerActorID := "partner", input.PartnerActorID
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'asset','EXTERNAL_SETTLEMENT_CASH',NULL,NULL,'DEBIT',$2,'YER'),($1,2,'asset','PARTNER_COMMISSION_RECEIVABLE',$3,$4,'CREDIT',$2,'YER')`, transactionID, input.AmountMinor, partnerActorType, partnerActorID); err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_commission_remittances(id,partner_actor_id,amount_minor,remittance_reference,evidence_reference,verified_by,ledger_transaction_id,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, remittanceID, input.PartnerActorID, input.AmountMinor, input.RemittanceReference, input.EvidenceReference, input.VerifiedBy, transactionID, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerCommissionRemittanceRecord{}, false, err
	}
	item, err := ReadPartnerCommissionRemittance(ctx, db, remittanceID)
	return item, false, err
}

func ReadPartnerCommissionRemittance(ctx context.Context, db *sql.DB, remittanceID string) (PartnerCommissionRemittanceRecord, error) {
	if db == nil || strings.TrimSpace(remittanceID) == "" {
		return PartnerCommissionRemittanceRecord{}, ErrPartnerRemittanceInvalid
	}
	return readPartnerCommissionRemittance(ctx, db, strings.TrimSpace(remittanceID))
}

func readPartnerCommissionRemittance(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, remittanceID string) (PartnerCommissionRemittanceRecord, error) {
	var item PartnerCommissionRemittanceRecord
	err := source.QueryRowContext(ctx, `SELECT id,partner_actor_id,amount_minor,currency,remittance_reference,evidence_reference,verified_by,verified_at,ledger_transaction_id,created_at FROM wlt.partner_commission_remittances WHERE id=$1`, remittanceID).Scan(&item.ID, &item.PartnerActorID, &item.AmountMinor, &item.Currency, &item.RemittanceReference, &item.EvidenceReference, &item.VerifiedBy, &item.VerifiedAt, &item.LedgerTransactionID, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerCommissionRemittanceRecord{}, ErrPartnerRemittanceInvalid
	}
	return item, err
}
