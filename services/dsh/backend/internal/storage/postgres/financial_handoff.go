package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type FinancialHandoffOutbox struct {
	ID              string
	EffectType      string
	SourceRef       string
	OrderID         string
	PaymentIntentID string
	CaptainActorID  string
	PartnerActorID  string
	AmountMinor     int64
	Reason          string
	IdempotencyKey  string
	CorrelationID   string
	ActingActorID   string
	Attempts        int
}

func enqueueFinancialHandoffTx(ctx context.Context, tx *sql.Tx, item FinancialHandoffOutbox) error {
	if tx == nil || strings.TrimSpace(item.EffectType) == "" || strings.TrimSpace(item.SourceRef) == "" || strings.TrimSpace(item.OrderID) == "" || strings.TrimSpace(item.PaymentIntentID) == "" || strings.TrimSpace(item.IdempotencyKey) == "" || strings.TrimSpace(item.CorrelationID) == "" || strings.TrimSpace(item.ActingActorID) == "" {
		return errors.New("financial handoff input is invalid")
	}
	id, err := newID("financial_handoff")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.commerce_financial_handoff_outbox
		(id,effect_type,source_ref,order_id,payment_intent_id,captain_actor_id,partner_actor_id,amount_minor,reason,idempotency_key,correlation_id,acting_actor_id)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,NULLIF($9,''),$10,$11,$12)
		ON CONFLICT (effect_type,order_id,source_ref) DO NOTHING`,
		id, strings.TrimSpace(item.EffectType), strings.TrimSpace(item.SourceRef), strings.TrimSpace(item.OrderID), strings.TrimSpace(item.PaymentIntentID),
		strings.TrimSpace(item.CaptainActorID), strings.TrimSpace(item.PartnerActorID), item.AmountMinor, strings.TrimSpace(item.Reason),
		strings.TrimSpace(item.IdempotencyKey), strings.TrimSpace(item.CorrelationID), strings.TrimSpace(item.ActingActorID))
	return err
}

func ListPendingFinancialHandoffs(ctx context.Context, db *sql.DB, limit int) ([]FinancialHandoffOutbox, error) {
	if db == nil || limit < 1 || limit > 100 {
		return nil, errors.New("financial handoff input is invalid")
	}
	rows, err := db.QueryContext(ctx, `SELECT id,effect_type,source_ref,order_id,payment_intent_id,COALESCE(captain_actor_id,''),COALESCE(partner_actor_id,''),amount_minor,COALESCE(reason,''),idempotency_key,correlation_id,acting_actor_id,attempts
		FROM dsh.commerce_financial_handoff_outbox
		WHERE state<>'POSTED' AND next_attempt_at<=clock_timestamp()
		ORDER BY next_attempt_at ASC,created_at ASC,id ASC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list financial handoffs: %w", err)
	}
	defer rows.Close()
	items := make([]FinancialHandoffOutbox, 0, limit)
	for rows.Next() {
		var item FinancialHandoffOutbox
		if err := rows.Scan(&item.ID, &item.EffectType, &item.SourceRef, &item.OrderID, &item.PaymentIntentID, &item.CaptainActorID, &item.PartnerActorID, &item.AmountMinor, &item.Reason, &item.IdempotencyKey, &item.CorrelationID, &item.ActingActorID, &item.Attempts); err != nil {
			return nil, fmt.Errorf("scan financial handoff: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read financial handoffs: %w", err)
	}
	return items, nil
}

func MarkFinancialHandoffFailure(ctx context.Context, db *sql.DB, outboxID, message string) error {
	if db == nil || strings.TrimSpace(outboxID) == "" {
		return errors.New("financial handoff input is invalid")
	}
	_, err := db.ExecContext(ctx, `UPDATE dsh.commerce_financial_handoff_outbox
		SET state='FAILED',attempts=attempts+1,last_error=NULLIF($2,''),next_attempt_at=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
		WHERE id=$1 AND state<>'POSTED'`, strings.TrimSpace(outboxID), strings.TrimSpace(message))
	return err
}

func MarkFinancialHandoffPosted(ctx context.Context, db *sql.DB, item FinancialHandoffOutbox) error {
	if db == nil || strings.TrimSpace(item.ID) == "" {
		return errors.New("financial handoff input is invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var targetPaymentState, auditEvent string
	switch item.EffectType {
	case "DELIVERY_SETTLEMENT", "STORE_PICKUP_COLLECTION", "PARTNER_CAPTAIN_STORE_CASH_COLLECTION", "PARTNER_CAPTAIN_BALANCE_SETTLEMENT":
		targetPaymentState, auditEvent = "COLLECTED", "payment_collected"
	case "PAYMENT_CANCEL":
		targetPaymentState, auditEvent = "CANCELLED", "payment_cancelled"
	case "CAPTAIN_COD_RELEASE", "ORDER_ADJUSTMENT_RECONCILIATION":
	default:
		return errors.New("unknown financial handoff effect")
	}

	var currentPaymentState string
	var orderTotal int64
	if targetPaymentState != "" {
		// Order transitions lock the Order before enqueueing its outbox item.
		err = tx.QueryRowContext(ctx, `SELECT payment_state,total_amount_minor FROM dsh.commerce_orders
			WHERE id=$1 AND payment_intent_id=$2 FOR UPDATE`, item.OrderID, item.PaymentIntentID).Scan(&currentPaymentState, &orderTotal)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrPaymentStateConflict
		}
		if err != nil {
			return err
		}
	}

	// Validate the exact durable event before mutating payment or cash state.
	// Attempts may have changed since the worker read the immutable facts.
	var outboxState string
	err = tx.QueryRowContext(ctx, `SELECT state FROM dsh.commerce_financial_handoff_outbox
		WHERE id=$1 AND effect_type=$2 AND source_ref=$3 AND order_id=$4 AND payment_intent_id=$5
			AND COALESCE(captain_actor_id,'')=$6 AND COALESCE(partner_actor_id,'')=$7 AND amount_minor=$8
			AND COALESCE(reason,'')=$9 AND idempotency_key=$10 AND correlation_id=$11 AND acting_actor_id=$12
		FOR UPDATE`, item.ID, item.EffectType, item.SourceRef, item.OrderID, item.PaymentIntentID,
		item.CaptainActorID, item.PartnerActorID, item.AmountMinor, item.Reason, item.IdempotencyKey, item.CorrelationID, item.ActingActorID).Scan(&outboxState)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrPaymentStateConflict
	}
	if err != nil {
		return err
	}
	if outboxState == "POSTED" {
		return tx.Commit()
	}

	if targetPaymentState != "" {
		if currentPaymentState == "REQUIRES_COLLECTION" {
			result, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_orders SET payment_state=$3,updated_at=clock_timestamp()
				WHERE id=$1 AND payment_intent_id=$2 AND payment_state='REQUIRES_COLLECTION'`, item.OrderID, item.PaymentIntentID, targetPaymentState)
			if err != nil {
				return err
			}
			affected, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if affected != 1 {
				return ErrPaymentStateConflict
			}
		} else if currentPaymentState != targetPaymentState {
			return ErrPaymentStateConflict
		}
		auditAmount := item.AmountMinor
		if item.EffectType == "PARTNER_CAPTAIN_BALANCE_SETTLEMENT" {
			auditAmount = orderTotal
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_payment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,payment_intent_id,from_state,to_state,amount_minor)
			VALUES($1,$2,$3,$4,$5,$6,'REQUIRES_COLLECTION',$7,$8)
			ON CONFLICT (event_type,idempotency_key) DO NOTHING`, auditEvent, item.IdempotencyKey, item.CorrelationID, item.ActingActorID,
			item.OrderID, item.PaymentIntentID, targetPaymentState, auditAmount); err != nil {
			return err
		}
	}
	if item.EffectType == "PARTNER_CAPTAIN_STORE_CASH_COLLECTION" {
		result, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_store_cash_handoffs
			SET state='SETTLED',settled_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
			WHERE order_id=$1 AND assignment_id=$2 AND captain_actor_id=$3 AND partner_actor_id=$4 AND amount_minor=$5
				AND confirmation_idempotency_key=$6 AND store_confirmed_by=$7 AND state='STORE_CONFIRMED'`,
			item.OrderID, item.SourceRef, item.CaptainActorID, item.PartnerActorID, item.AmountMinor, item.IdempotencyKey, item.ActingActorID)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected != 1 {
			return ErrPaymentStateConflict
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_financial_handoff_outbox SET state='POSTED',attempts=attempts+1,last_error=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND state<>'POSTED'`, item.ID); err != nil {
		return err
	}
	return tx.Commit()
}
