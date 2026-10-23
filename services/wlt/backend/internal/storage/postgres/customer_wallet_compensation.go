package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

var (
	ErrCustomerWalletCompensationInput          = errors.New("customer wallet compensation input is invalid")
	ErrCustomerWalletCompensationNotCollected   = errors.New("customer wallet compensation requires confirmed collection")
	ErrCustomerWalletCompensationExceedsPayment = errors.New("customer wallet compensation exceeds the original customer payment")
	ErrCustomerWalletCompensationConflict       = errors.New("customer wallet compensation conflicts with an existing decision")
)

type CustomerWalletCompensationInput struct {
	CaseID            string
	AmountMinor       int64
	ApprovedByActorID string
	EvidenceReference string
	IdempotencyKey    string
	CorrelationID     string
}

type CustomerWalletCompensationRecord struct {
	CaseID              string    `json:"caseId"`
	OrderID             string    `json:"orderId"`
	CustomerActorID     string    `json:"customerActorId"`
	AmountMinor         int64     `json:"amountMinor"`
	Currency            string    `json:"currency"`
	ApprovedByActorID   string    `json:"approvedByActorId"`
	EvidenceReference   string    `json:"evidenceReference"`
	LedgerTransactionID string    `json:"ledgerTransactionId"`
	CreatedAt           time.Time `json:"createdAt"`
}

const readCustomerWalletCompensationSQL = `SELECT case_id,order_id,customer_actor_id,amount_minor,'YER',approved_by_actor_id,
 evidence_reference,ledger_transaction_id,created_at,request_hash
 FROM wlt.customer_wallet_compensations WHERE case_id=$1`

func readCustomerWalletCompensation(ctx context.Context, tx *sql.Tx, caseID string) (CustomerWalletCompensationRecord, string, error) {
	var item CustomerWalletCompensationRecord
	var requestHash string
	err := tx.QueryRowContext(ctx, readCustomerWalletCompensationSQL, caseID).Scan(
		&item.CaseID, &item.OrderID, &item.CustomerActorID, &item.AmountMinor, &item.Currency,
		&item.ApprovedByActorID, &item.EvidenceReference, &item.LedgerTransactionID, &item.CreatedAt, &requestHash)
	return item, requestHash, err
}

// CreditReviewedCustomerCompensation posts one explicit, Finance-approved
// platform-funded amount to the existing customer wallet. A separate Store
// reversal is not implied and cannot be silently inferred from this posting.
func CreditReviewedCustomerCompensation(ctx context.Context, db *sql.DB, input CustomerWalletCompensationInput) (CustomerWalletCompensationRecord, bool, error) {
	input.CaseID = strings.TrimSpace(input.CaseID)
	input.ApprovedByActorID = strings.TrimSpace(input.ApprovedByActorID)
	input.EvidenceReference = strings.TrimSpace(input.EvidenceReference)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || len(input.CaseID) < 1 || len(input.CaseID) > 128 || input.AmountMinor <= 0 ||
		len(input.ApprovedByActorID) < 1 || len(input.ApprovedByActorID) > 128 ||
		len(input.EvidenceReference) < 8 || len(input.EvidenceReference) > 128 ||
		len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 ||
		len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationInput
	}
	fingerprint := hashFacts("customer-wallet-compensation-v1", input.CaseID,
		strconv.FormatInt(input.AmountMinor, 10), input.EvidenceReference)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()

	var orderID, customerID, paymentID, caseState string
	err = tx.QueryRowContext(ctx, `SELECT order_id,customer_actor_id,payment_intent_id,state
  FROM wlt.order_adjustment_reconciliation_cases WHERE id=$1`, input.CaseID).
		Scan(&orderID, &customerID, &paymentID, &caseState)
	if errors.Is(err, sql.ErrNoRows) {
		return CustomerWalletCompensationRecord{}, false, ErrOrderAdjustmentReconciliationNotFound
	}
	if err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:compensation:"+orderID); err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	if previous, storedHash, readErr := readCustomerWalletCompensation(ctx, tx, input.CaseID); readErr == nil {
		if fingerprint != storedHash {
			return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationConflict
		}
		if err := tx.Commit(); err != nil {
			return CustomerWalletCompensationRecord{}, false, err
		}
		return previous, true, nil
	} else if !errors.Is(readErr, sql.ErrNoRows) {
		return CustomerWalletCompensationRecord{}, false, readErr
	}
	if caseState != "RECONCILIATION_REQUIRED" {
		return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationConflict
	}
	var reusedCase string
	if err = tx.QueryRowContext(ctx, `SELECT case_id FROM wlt.customer_wallet_compensations WHERE idempotency_key=$1`, input.IdempotencyKey).Scan(&reusedCase); err == nil {
		return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationConflict
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CustomerWalletCompensationRecord{}, false, err
	}

	var paymentState, payer, currency, allocatedOrder string
	var payable, subtotal int64
	err = tx.QueryRowContext(ctx, `SELECT intent.state,intent.payer_actor_id,intent.currency,allocation.order_id,
  allocation.customer_payable_minor,allocation.subtotal_minor
  FROM wlt.payment_intents intent
  JOIN wlt.customer_payment_allocations allocation ON allocation.payment_intent_id=intent.id
  WHERE intent.id=$1 FOR UPDATE OF intent,allocation`, paymentID).
		Scan(&paymentState, &payer, &currency, &allocatedOrder, &payable, &subtotal)
	if errors.Is(err, sql.ErrNoRows) {
		return CustomerWalletCompensationRecord{}, false, ErrOrderAdjustmentReconciliationNotFound
	}
	if err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	if paymentState != domain.StateCollected {
		return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationNotCollected
	}
	if payer != customerID || allocatedOrder != orderID || currency != "YER" {
		return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationConflict
	}
	if err = lockCustomerWalletBalance(ctx, tx, customerID); err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	var already int64
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(amount_minor),0)
  FROM wlt.customer_wallet_compensations WHERE order_id=$1`, orderID).Scan(&already)
	if err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	if payable <= 0 || subtotal <= 0 || already > payable || input.AmountMinor > payable-already || input.AmountMinor > subtotal {
		return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationExceedsPayment
	}
	ledgerID, err := newID("ledger")
	if err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(
  id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id)
  VALUES($1,'CUSTOMER_WALLET_COMPENSATED','ORDER_ADJUSTMENT_COMPENSATION',$2,'YER',$3,$4,$5)`,
		ledgerID, input.CaseID, input.IdempotencyKey, fingerprint, input.CorrelationID); err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(
  transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency)
  VALUES($1,1,'expense','CUSTOMER_COMPENSATION_EXPENSE',NULL,NULL,'DEBIT',$2,'YER'),
        ($1,2,'liability','CUSTOMER_WALLET','customer',$3,'CREDIT',$2,'YER')`,
		ledgerID, input.AmountMinor, customerID); err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.customer_wallet_compensations(
  case_id,order_id,customer_actor_id,amount_minor,approved_by_actor_id,evidence_reference,
  ledger_transaction_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		input.CaseID, orderID, customerID, input.AmountMinor, input.ApprovedByActorID, input.EvidenceReference,
		ledgerID, input.IdempotencyKey, fingerprint); err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	// The wallet credit and review closure are one atomic financial result.
	closed, err := tx.ExecContext(ctx, `UPDATE wlt.order_adjustment_reconciliation_cases
  SET state='COMPENSATED' WHERE id=$1 AND state='RECONCILIATION_REQUIRED'`, input.CaseID)
	if err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	closedCount, err := closed.RowsAffected()
	if err != nil || closedCount != 1 {
		return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationConflict
	}
	confirmed, storedHash, err := readCustomerWalletCompensation(ctx, tx, input.CaseID)
	if err != nil || storedHash != fingerprint {
		return CustomerWalletCompensationRecord{}, false, ErrCustomerWalletCompensationConflict
	}
	if err = tx.Commit(); err != nil {
		return CustomerWalletCompensationRecord{}, false, err
	}
	return confirmed, false, nil
}
