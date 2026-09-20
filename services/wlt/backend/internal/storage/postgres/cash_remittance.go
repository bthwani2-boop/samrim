package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrRemittanceNotFound     = errors.New("cash remittance was not found")
	ErrRemittanceExists       = errors.New("cash remittance already exists for this payment intent")
	ErrRemittanceIdempotency  = errors.New("cash remittance idempotency key was already used with different facts")
	ErrRemittanceInvalidInput = errors.New("cash remittance input is invalid")
)

type CashLiability struct {
	PaymentIntentID   string
	ExternalReference string
	CaptainActorID    string
	AmountMinor       int64
	Currency          string
	PaymentVersion    int
	CollectedAt       time.Time
}

type CashLiabilityList struct {
	Items            []CashLiability
	TotalAmountMinor int64
}

type CashRemittanceRecord struct {
	ID                  string
	PaymentIntentID     string
	CaptainActorID      string
	AmountMinor         int64
	Currency            string
	RemittanceReference string
	State               string
	CreatedAt           time.Time
}

type RemitCashInput struct {
	PaymentIntentID        string
	CaptainActorID         string
	AmountMinor            int64
	RemittanceReference    string
	ExpectedPaymentVersion int
	IdempotencyKey         string
	CorrelationID          string
}

func HashRemitCashRequest(input RemitCashInput) string {
	return hashFacts("cash-remit", input.PaymentIntentID, input.CaptainActorID, fmt.Sprintf("%d", input.AmountMinor), input.RemittanceReference, fmt.Sprintf("%d", input.ExpectedPaymentVersion))
}

func ListCashLiability(ctx context.Context, db *sql.DB, captainActorID string, limit int) (CashLiabilityList, error) {
	captainActorID = strings.TrimSpace(captainActorID)
	if db == nil || captainActorID == "" || limit < 1 || limit > 100 {
		return CashLiabilityList{}, ErrRemittanceInvalidInput
	}
	rows, err := db.QueryContext(ctx, `
		SELECT p.id, p.external_reference, p.collected_by_actor_id, p.amount_minor, p.currency, p.version, p.collected_at
		FROM wlt.payment_intents p
		LEFT JOIN wlt.cash_remittances r ON r.payment_intent_id = p.id
		WHERE p.state='COLLECTED' AND p.collected_by_actor_id=$1 AND r.id IS NULL
		ORDER BY p.collected_at ASC, p.id ASC
		LIMIT $2`, captainActorID, limit)
	if err != nil {
		return CashLiabilityList{}, fmt.Errorf("list cash liability: %w", err)
	}
	defer rows.Close()
	result := CashLiabilityList{Items: make([]CashLiability, 0)}
	for rows.Next() {
		var item CashLiability
		if err := rows.Scan(&item.PaymentIntentID, &item.ExternalReference, &item.CaptainActorID, &item.AmountMinor, &item.Currency, &item.PaymentVersion, &item.CollectedAt); err != nil {
			return CashLiabilityList{}, fmt.Errorf("scan cash liability: %w", err)
		}
		result.Items = append(result.Items, item)
		result.TotalAmountMinor += item.AmountMinor
	}
	if err := rows.Err(); err != nil {
		return CashLiabilityList{}, fmt.Errorf("iterate cash liability: %w", err)
	}
	return result, nil
}

func RemitCash(ctx context.Context, db *sql.DB, input RemitCashInput) (CashRemittanceRecord, bool, error) {
	input.PaymentIntentID = strings.TrimSpace(input.PaymentIntentID)
	input.CaptainActorID = strings.TrimSpace(input.CaptainActorID)
	input.RemittanceReference = strings.TrimSpace(input.RemittanceReference)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.PaymentIntentID == "" || input.CaptainActorID == "" || input.AmountMinor <= 0 || input.ExpectedPaymentVersion < 1 || len(input.RemittanceReference) < 1 || len(input.RemittanceReference) > 128 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return CashRemittanceRecord{}, false, ErrRemittanceInvalidInput
	}
	requestHash := HashRemitCashRequest(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:cash-remit:"+input.IdempotencyKey); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	var storedHash, existingID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,id FROM wlt.cash_remittances WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &existingID)
	if err == nil {
		if storedHash != requestHash {
			return CashRemittanceRecord{}, false, ErrRemittanceIdempotency
		}
		result, readErr := readCashRemittance(ctx, tx, existingID)
		if readErr != nil {
			return CashRemittanceRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CashRemittanceRecord{}, false, err
		}
		return result, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, false, err
	}
	var payment PaymentIntentRecord
	if err := scanPaymentIntent(tx.QueryRowContext(ctx, `SELECT id,external_reference,payer_actor_id,amount_minor,currency,method,state,version,collected_amount_minor,collected_by_actor_id,collection_reference,collected_at,cancellation_reason,created_at,updated_at FROM wlt.payment_intents WHERE id=$1 FOR UPDATE`, input.PaymentIntentID), &payment); errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, false, ErrNotFound
	} else if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if payment.State != "COLLECTED" || payment.CollectedByActorID == nil || *payment.CollectedByActorID != input.CaptainActorID || payment.CollectedAmountMinor == nil || *payment.CollectedAmountMinor != input.AmountMinor || payment.Version != input.ExpectedPaymentVersion {
		return CashRemittanceRecord{}, false, ErrRemittanceInvalidInput
	}
	var duplicateID string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.cash_remittances WHERE payment_intent_id=$1 FOR UPDATE", input.PaymentIntentID).Scan(&duplicateID); err == nil {
		return CashRemittanceRecord{}, false, ErrRemittanceExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, false, err
	}
	remittanceID, err := newID("cash_remit")
	if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.cash_remittances(id,payment_intent_id,captain_actor_id,amount_minor,currency,remittance_reference,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, remittanceID, input.PaymentIntentID, input.CaptainActorID, input.AmountMinor, payment.Currency, input.RemittanceReference, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.cash_remittance_events(remittance_id,payment_intent_id,event_type,idempotency_key,request_hash,correlation_id,captain_actor_id,amount_minor) VALUES($1,$2,'CASH_REMITTED',$3,$4,$5,$6,$7)`, remittanceID, input.PaymentIntentID, input.IdempotencyKey, requestHash, input.CorrelationID, input.CaptainActorID, input.AmountMinor); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	result, err := ReadCashRemittance(ctx, db, remittanceID)
	return result, false, err
}

func ReadCashRemittance(ctx context.Context, db *sql.DB, remittanceID string) (CashRemittanceRecord, error) {
	if db == nil || strings.TrimSpace(remittanceID) == "" {
		return CashRemittanceRecord{}, ErrRemittanceInvalidInput
	}
	return readCashRemittance(ctx, db, strings.TrimSpace(remittanceID))
}

func readCashRemittance(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, remittanceID string) (CashRemittanceRecord, error) {
	var result CashRemittanceRecord
	err := source.QueryRowContext(ctx, `SELECT id,payment_intent_id,captain_actor_id,amount_minor,currency,remittance_reference,state,created_at FROM wlt.cash_remittances WHERE id=$1`, remittanceID).Scan(&result.ID, &result.PaymentIntentID, &result.CaptainActorID, &result.AmountMinor, &result.Currency, &result.RemittanceReference, &result.State, &result.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, ErrRemittanceNotFound
	}
	return result, err
}
