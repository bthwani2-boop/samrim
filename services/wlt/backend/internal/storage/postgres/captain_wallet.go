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
	ErrCaptainWalletInvalidInput      = errors.New("captain wallet input is invalid")
	ErrCaptainWalletInsufficientFunds = errors.New("captain wallet has insufficient available funds")
	ErrCaptainWalletFundingNotFound   = errors.New("captain wallet funding was not found")
	ErrCaptainCODReservationNotFound  = errors.New("captain COD reservation was not found")
	ErrCaptainCODReservationState     = errors.New("captain COD reservation state does not allow this operation")
	ErrCaptainCODReservationInput     = errors.New("captain COD reservation input is invalid")
	ErrCaptainCODAllocationNotFound   = errors.New("captain COD payment allocation was not found")
	ErrCaptainCODNoCashExposure       = errors.New("payment allocation has no cash COD exposure")
)

type CaptainWalletFundingInput struct {
	CaptainActorID    string
	AmountMinor       int64
	FundingReason     string
	EvidenceReference string
	CreatedBy         string
	IdempotencyKey    string
	CorrelationID     string
}

type CaptainWalletFundingRecord struct {
	ID                  string
	CaptainActorID      string
	AmountMinor         int64
	Currency            string
	FundingReason       string
	EvidenceReference   string
	CreatedBy           string
	LedgerTransactionID string
	CreatedAt           time.Time
}

type CaptainWalletStateRecord struct {
	CaptainActorID     string
	Currency           string
	LedgerBalanceMinor int64
	HeldMinor          int64
	AvailableMinor     int64
}

type CaptainCODReservationInput struct {
	OrderID         string
	PaymentIntentID string
	CaptainActorID  string
	IdempotencyKey  string
	CorrelationID   string
}

type CaptainCODReservationRecord struct {
	ID                  string
	OrderID             string
	PaymentIntentID     string
	CaptainActorID      string
	AmountMinor         int64
	Currency            string
	State               string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ReleasedAt  *time.Time
	FinalizedAt *time.Time
	RemittedAt  *time.Time
}

func HashCaptainWalletFunding(input CaptainWalletFundingInput) string {
	return hashFacts("captain-wallet-funding", strings.TrimSpace(input.CaptainActorID), fmt.Sprintf("%d", input.AmountMinor), strings.TrimSpace(input.FundingReason), strings.TrimSpace(input.EvidenceReference), strings.TrimSpace(input.CreatedBy))
}

func HashCaptainCODReservation(input CaptainCODReservationInput, operation string) string {
	return hashFacts("captain-cod-reservation", strings.TrimSpace(operation), strings.TrimSpace(input.OrderID), strings.TrimSpace(input.PaymentIntentID), strings.TrimSpace(input.CaptainActorID))
}

func CreateCaptainWalletFunding(ctx context.Context, db *sql.DB, input CaptainWalletFundingInput) (CaptainWalletFundingRecord, bool, error) {
	input.CaptainActorID = strings.TrimSpace(input.CaptainActorID)
	input.FundingReason = strings.TrimSpace(input.FundingReason)
	input.EvidenceReference = strings.TrimSpace(input.EvidenceReference)
	input.CreatedBy = strings.TrimSpace(input.CreatedBy)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.CaptainActorID == "" || input.AmountMinor <= 0 || input.FundingReason == "" || input.EvidenceReference == "" || input.CreatedBy == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return CaptainWalletFundingRecord{}, false, ErrCaptainWalletInvalidInput
	}
	requestHash := HashCaptainWalletFunding(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainWalletFundingRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:captain-wallet:"+input.CaptainActorID); err != nil {
		return CaptainWalletFundingRecord{}, false, err
	}
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.captain_wallet_funding WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return CaptainWalletFundingRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readCaptainWalletFunding(ctx, tx, existingID)
		if readErr != nil {
			return CaptainWalletFundingRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainWalletFundingRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainWalletFundingRecord{}, false, err
	}
	fundingID, err := newID("captain-funding")
	if err != nil {
		return CaptainWalletFundingRecord{}, false, err
	}
	transactionID, err := newID("ledger")
	if err != nil {
		return CaptainWalletFundingRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'CAPTAIN_OPENING_FUNDING','CAPTAIN_OPENING_FUNDING',$2,'YER',$3,$4,$5)`, transactionID, fundingID, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CaptainWalletFundingRecord{}, false, err
	}
	if err := insertCaptainFundingLedgerEntries(ctx, tx, transactionID, input.CaptainActorID, input.AmountMinor); err != nil {
		return CaptainWalletFundingRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.captain_wallet_funding(id,captain_actor_id,amount_minor,currency,funding_reason,evidence_reference,created_by,ledger_transaction_id,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,'YER',$4,$5,$6,$7,$8,$9,$10)`, fundingID, input.CaptainActorID, input.AmountMinor, input.FundingReason, input.EvidenceReference, input.CreatedBy, transactionID, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CaptainWalletFundingRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainWalletFundingRecord{}, false, err
	}
	item, err := readCaptainWalletFunding(ctx, db, fundingID)
	return item, false, err
}

func ReadCaptainWalletState(ctx context.Context, db *sql.DB, captainActorID string) (CaptainWalletStateRecord, error) {
	captainActorID = strings.TrimSpace(captainActorID)
	if db == nil || captainActorID == "" {
		return CaptainWalletStateRecord{}, ErrCaptainWalletInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainWalletStateRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	state, err := readCaptainWalletStateTx(ctx, tx, captainActorID)
	if err != nil {
		return CaptainWalletStateRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainWalletStateRecord{}, err
	}
	return state, nil
}

func ReserveCaptainCOD(ctx context.Context, db *sql.DB, input CaptainCODReservationInput) (CaptainCODReservationRecord, bool, error) {
	input = normalizeCaptainCODReservationInput(input)
	if db == nil || input.OrderID == "" || input.PaymentIntentID == "" || input.CaptainActorID == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return CaptainCODReservationRecord{}, false, ErrCaptainCODReservationInput
	}
	requestHash := HashCaptainCODReservation(input, "reserve")
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:captain-cod:"+input.PaymentIntentID); err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	var existingReservationID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT reservation_id,request_hash FROM wlt.captain_cod_reservation_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingReservationID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return CaptainCODReservationRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readCaptainCODReservation(ctx, tx, existingReservationID)
		if readErr != nil {
			return CaptainCODReservationRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainCODReservationRecord{}, false, err
	}
	var amountMinor int64
	err = tx.QueryRowContext(ctx, `SELECT a.cash_amount_minor FROM wlt.payment_intents p JOIN wlt.payment_allocations a ON a.payment_intent_id=p.id WHERE p.id=$1 AND a.order_id=$2 AND p.state IN ('REQUIRES_COLLECTION','COLLECTED') FOR UPDATE`, input.PaymentIntentID, input.OrderID).Scan(&amountMinor)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainCODReservationRecord{}, false, ErrCaptainCODAllocationNotFound
	}
	if err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	if amountMinor <= 0 {
		return CaptainCODReservationRecord{}, false, ErrCaptainCODNoCashExposure
	}
	state, err := readCaptainWalletStateTx(ctx, tx, input.CaptainActorID)
	if err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	if state.AvailableMinor < amountMinor {
		return CaptainCODReservationRecord{}, false, ErrCaptainWalletInsufficientFunds
	}
	reservationID, err := newID("captain-cod")
	if err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.captain_cod_reservations(id,order_id,payment_intent_id,captain_actor_id,amount_minor,currency,state,reserve_idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,'YER','ACTIVE',$6,$7,$8)`, reservationID, input.OrderID, input.PaymentIntentID, input.CaptainActorID, amountMinor, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	if err := insertCaptainCODReservationEvent(ctx, tx, reservationID, "CAPTAIN_COD_RESERVED", input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	item, err := readCaptainCODReservation(ctx, db, reservationID)
	return item, false, err
}

func ReleaseCaptainCOD(ctx context.Context, db *sql.DB, input CaptainCODReservationInput) (CaptainCODReservationRecord, bool, error) {
	return transitionCaptainCOD(ctx, db, input, "release")
}

func FinalizeCaptainCOD(ctx context.Context, db *sql.DB, input CaptainCODReservationInput) (CaptainCODReservationRecord, bool, error) {
	return transitionCaptainCOD(ctx, db, input, "finalize")
}

func transitionCaptainCOD(ctx context.Context, db *sql.DB, input CaptainCODReservationInput, operation string) (CaptainCODReservationRecord, bool, error) {
	input = normalizeCaptainCODReservationInput(input)
	if db == nil || input.OrderID == "" || input.PaymentIntentID == "" || input.CaptainActorID == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 || (operation != "release" && operation != "finalize") {
		return CaptainCODReservationRecord{}, false, ErrCaptainCODReservationInput
	}
	requestHash := HashCaptainCODReservation(input, operation)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:captain-cod:"+input.PaymentIntentID); err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	var existingReservationID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT reservation_id,request_hash FROM wlt.captain_cod_reservation_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingReservationID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return CaptainCODReservationRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readCaptainCODReservation(ctx, tx, existingReservationID)
		if readErr != nil {
			return CaptainCODReservationRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainCODReservationRecord{}, false, err
	}
	var reservation CaptainCODReservationRecord
	err = scanCaptainCODReservation(tx.QueryRowContext(ctx, `SELECT id,order_id,payment_intent_id,captain_actor_id,amount_minor,currency,state,created_at,updated_at,released_at,finalized_at,remitted_at FROM wlt.captain_cod_reservations WHERE order_id=$1 AND payment_intent_id=$2 AND captain_actor_id=$3 FOR UPDATE`, input.OrderID, input.PaymentIntentID, input.CaptainActorID), &reservation)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainCODReservationRecord{}, false, ErrCaptainCODReservationNotFound
	}
	if err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	wantState := "RELEASED"
	eventType := "CAPTAIN_COD_RELEASED"
	if operation == "finalize" {
		wantState = "FINALIZED"
		eventType = "CAPTAIN_COD_FINALIZED"
	}
	if reservation.State != "ACTIVE" {
		if reservation.State == wantState {
			if err := tx.Commit(); err != nil {
				return CaptainCODReservationRecord{}, false, err
			}
			return reservation, true, nil
		}
		return CaptainCODReservationRecord{}, false, ErrCaptainCODReservationState
	}
	if operation == "finalize" {
		if _, err := tx.ExecContext(ctx, `UPDATE wlt.captain_cod_reservations SET state=$2,finalized_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND state='ACTIVE'`, reservation.ID, wantState); err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
		now := time.Now().UTC()
		reservation.FinalizedAt = &now
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE wlt.captain_cod_reservations SET state=$2,released_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND state='ACTIVE'`, reservation.ID, wantState); err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
	}
	reservation.State = wantState
	if operation == "release" {
		now := time.Now().UTC()
		reservation.ReleasedAt = &now
	}
	if err := insertCaptainCODReservationEvent(ctx, tx, reservation.ID, eventType, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	item, err := readCaptainCODReservation(ctx, db, reservation.ID)
	return item, false, err
}

func readCaptainWalletFunding(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string) (CaptainWalletFundingRecord, error) {
	var item CaptainWalletFundingRecord
	err := source.QueryRowContext(ctx, `SELECT id,captain_actor_id,amount_minor,currency,funding_reason,evidence_reference,created_by,ledger_transaction_id,created_at FROM wlt.captain_wallet_funding WHERE id=$1`, id).Scan(&item.ID, &item.CaptainActorID, &item.AmountMinor, &item.Currency, &item.FundingReason, &item.EvidenceReference, &item.CreatedBy, &item.LedgerTransactionID, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainWalletFundingRecord{}, ErrCaptainWalletFundingNotFound
	}
	return item, err
}

func readCaptainWalletStateTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, captainActorID string) (CaptainWalletStateRecord, error) {
	var item CaptainWalletStateRecord
	item.CaptainActorID, item.Currency = captainActorID, "YER"
	if err := source.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0) FROM wlt.ledger_entries WHERE account_code='CAPTAIN_WALLET' AND actor_type='captain' AND actor_id=$1 AND currency='YER'`, captainActorID).Scan(&item.LedgerBalanceMinor); err != nil {
		return CaptainWalletStateRecord{}, err
	}
	if err := source.QueryRowContext(ctx, `SELECT COALESCE((SELECT SUM(amount_minor) FROM wlt.captain_cod_reservations WHERE captain_actor_id=$1 AND state IN ('ACTIVE','FINALIZED')),0) + COALESCE((SELECT SUM(amount_minor) FROM wlt.payout_holds WHERE actor_type='captain' AND actor_id=$1 AND status='ACTIVE'),0)`, captainActorID).Scan(&item.HeldMinor); err != nil {
		return CaptainWalletStateRecord{}, err
	}
	item.AvailableMinor = item.LedgerBalanceMinor - item.HeldMinor
	return item, nil
}

func insertCaptainFundingLedgerEntries(ctx context.Context, tx *sql.Tx, transactionID, captainActorID string, amountMinor int64) error {
	if amountMinor <= 0 {
		return ErrCaptainWalletInvalidInput
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'asset','EXTERNAL_SETTLEMENT_CASH',NULL,NULL,'DEBIT',$2,'YER')`, transactionID, amountMinor); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,2,'liability','CAPTAIN_WALLET','captain',$2,'CREDIT',$3,'YER')`, transactionID, captainActorID, amountMinor); err != nil {
		return err
	}
	return nil
}

func insertCaptainCODReservationEvent(ctx context.Context, tx *sql.Tx, reservationID, eventType, idempotencyKey, requestHash, correlationID string) error {
	eventID, err := newID("captain-cod-event")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.captain_cod_reservation_events(id,reservation_id,event_type,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6)`, eventID, reservationID, eventType, idempotencyKey, requestHash, correlationID)
	return err
}

func readCaptainCODReservation(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string) (CaptainCODReservationRecord, error) {
	var item CaptainCODReservationRecord
	err := scanCaptainCODReservation(source.QueryRowContext(ctx, `SELECT id,order_id,payment_intent_id,captain_actor_id,amount_minor,currency,state,created_at,updated_at,released_at,finalized_at,remitted_at FROM wlt.captain_cod_reservations WHERE id=$1`, id), &item)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainCODReservationRecord{}, ErrCaptainCODReservationNotFound
	}
	return item, err
}

func scanCaptainCODReservation(row *sql.Row, item *CaptainCODReservationRecord) error {
	return row.Scan(&item.ID, &item.OrderID, &item.PaymentIntentID, &item.CaptainActorID, &item.AmountMinor, &item.Currency, &item.State, &item.CreatedAt, &item.UpdatedAt, &item.ReleasedAt, &item.FinalizedAt, &item.RemittedAt)
}

func normalizeCaptainCODReservationInput(input CaptainCODReservationInput) CaptainCODReservationInput {
	input.OrderID = strings.TrimSpace(input.OrderID)
	input.PaymentIntentID = strings.TrimSpace(input.PaymentIntentID)
	input.CaptainActorID = strings.TrimSpace(input.CaptainActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	return input
}
