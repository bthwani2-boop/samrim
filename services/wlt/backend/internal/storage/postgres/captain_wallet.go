package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"github.com/lib/pq"
)

var (
	ErrCaptainWalletInvalidInput      = errors.New("captain wallet input is invalid")
	ErrCaptainWalletInsufficientFunds = errors.New("captain wallet has insufficient available funds")
	ErrCaptainCODReservationNotFound  = errors.New("captain COD reservation was not found")
	ErrCaptainCODReservationState     = errors.New("captain COD reservation state does not allow this operation")
	ErrCaptainCODReservationInput     = errors.New("captain COD reservation input is invalid")
	ErrCaptainCODAllocationNotFound   = errors.New("captain COD payment allocation was not found")
	ErrCaptainCODNoCashExposure       = errors.New("payment allocation has no cash COD exposure")
)

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
	ID              string
	OrderID         string
	PaymentIntentID string
	CaptainActorID  string
	AmountMinor     int64
	Currency        string
	State           string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ReleasedAt      *time.Time
	FinalizedAt     *time.Time
	RemittedAt      *time.Time
}

func HashCaptainCODReservation(input CaptainCODReservationInput, operation string) string {
	return hashFacts("captain-cod-reservation", strings.TrimSpace(operation), strings.TrimSpace(input.OrderID), strings.TrimSpace(input.PaymentIntentID), strings.TrimSpace(input.CaptainActorID))
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

func lockCaptainWalletBalance(ctx context.Context, tx *sql.Tx, captainActorID string) error {
	captainActorID = strings.TrimSpace(captainActorID)
	if tx == nil || boundedText(captainActorID, 1, 128) == "" {
		return ErrCaptainWalletInvalidInput
	}
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:captain-balance:"+captainActorID)
	return err
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
	err = tx.QueryRowContext(ctx, `SELECT a.cash_amount_minor FROM wlt.payment_intents p JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=p.id WHERE p.id=$1 AND a.order_id=$2 AND p.method=$3 AND p.state IN ('REQUIRES_COLLECTION','COLLECTED') FOR UPDATE`, input.PaymentIntentID, input.OrderID, domain.MethodCashOnDelivery).Scan(&amountMinor)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainCODReservationRecord{}, false, ErrCaptainCODAllocationNotFound
	}
	if err != nil {
		return CaptainCODReservationRecord{}, false, err
	}
	if amountMinor <= 0 {
		return CaptainCODReservationRecord{}, false, ErrCaptainCODNoCashExposure
	}
	if err := lockCaptainWalletBalance(ctx, tx, input.CaptainActorID); err != nil {
		return CaptainCODReservationRecord{}, false, err
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
		// With parallel DSH offers, another Captain may reserve the same order
		// first. This is a normal assignment race, not a WLT storage outage.
		var conflict *pq.Error
		if errors.As(err, &conflict) && conflict.Code == "23505" && (conflict.Constraint == "captain_cod_reservations_active_order_uq" || conflict.Constraint == "captain_cod_reservations_active_payment_intent_uq") {
			return CaptainCODReservationRecord{}, false, ErrCaptainCODReservationState
		}
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
	if err := lockCaptainWalletBalance(ctx, tx, input.CaptainActorID); err != nil {
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
		wantState = "DEBITED"
		eventType = "CAPTAIN_COD_DEBITED"
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
		// Collected cash cannot be used to settle an order unless the same
		// Captain's order earning (and cash receivable) was posted first.
		var receivableMinor int64
		err := tx.QueryRowContext(ctx, `SELECT a.cash_amount_minor FROM wlt.payment_intents p
			JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=p.id AND a.order_id=$2
			JOIN wlt.partner_order_earnings e ON e.order_id=a.order_id AND e.payment_intent_id=p.id AND e.captain_actor_id=$3
			WHERE p.id=$1 AND p.state='COLLECTED' AND p.method=$4 AND p.collected_by_actor_id=$3
			FOR SHARE OF p,a,e`,
			input.PaymentIntentID, input.OrderID, input.CaptainActorID, domain.MethodCashOnDelivery).Scan(&receivableMinor)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && (receivableMinor <= 0 || receivableMinor != reservation.AmountMinor)) {
			return CaptainCODReservationRecord{}, false, ErrCaptainCODReservationState
		}
		if err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
		// A legacy remittance must never be charged a second time.
		var remittanceExists bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM wlt.cash_remittances WHERE payment_intent_id=$1)", input.PaymentIntentID).Scan(&remittanceExists); err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
		if remittanceExists {
			return CaptainCODReservationRecord{}, false, ErrCaptainCODReservationState
		}
		transactionID, err := newID("ledger")
		if err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
		// The Captain keeps collected cash. A pair of balanced ledger
		// entries atomically reduces wallet liability and cash receivable.
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions
			(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id)
			VALUES($1,'CAPTAIN_COD_WALLET_DEBITED','CAPTAIN_COD_WALLET_DEBIT',$2,$3,$4,$5,$6)`,
			transactionID, reservation.ID, reservation.Currency, "captain-cod-debit:"+hashFacts(reservation.ID), requestHash, input.CorrelationID); err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries
			(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency)
			VALUES($1,1,'liability','CAPTAIN_WALLET','captain',$2,'DEBIT',$3,$4),
				($1,2,'asset','CAPTAIN_CASH_RECEIVABLE',NULL,NULL,'CREDIT',$3,$4)`,
			transactionID, reservation.CaptainActorID, reservation.AmountMinor, reservation.Currency); err != nil {
			return CaptainCODReservationRecord{}, false, err
		}
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

func readCaptainWalletStateTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, captainActorID string) (CaptainWalletStateRecord, error) {
	var item CaptainWalletStateRecord
	item.CaptainActorID, item.Currency = captainActorID, "YER"
	if err := source.QueryRowContext(ctx, `
		SELECT
			COALESCE((SELECT SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END)
				FROM wlt.ledger_entries WHERE account_code='CAPTAIN_WALLET' AND actor_type='captain' AND actor_id=$1 AND currency='YER'),0),
			COALESCE((SELECT SUM(amount_minor) FROM wlt.captain_cod_reservations
				WHERE captain_actor_id=$1 AND state IN ('ACTIVE','FINALIZED')),0)
			+ COALESCE((SELECT SUM(amount_minor) FROM wlt.payout_holds
				WHERE actor_type='captain' AND actor_id=$1 AND status='ACTIVE'),0)`, captainActorID).Scan(&item.LedgerBalanceMinor, &item.HeldMinor); err != nil {
		return CaptainWalletStateRecord{}, err
	}
	item.AvailableMinor = item.LedgerBalanceMinor - item.HeldMinor
	return item, nil
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
