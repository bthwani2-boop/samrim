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
		if err := rows.Scan(&item.ID,&item.EffectType,&item.SourceRef,&item.OrderID,&item.PaymentIntentID,&item.CaptainActorID,&item.PartnerActorID,&item.AmountMinor,&item.Reason,&item.IdempotencyKey,&item.CorrelationID,&item.ActingActorID,&item.Attempts); err != nil {
			return nil, fmt.Errorf("scan financial handoff: %w", err)
		}
		items = append(items,item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read financial handoffs: %w", err)
	}
	return items,nil
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
	tx, err := db.BeginTx(ctx,nil)
	if err != nil { return err }
	defer func(){ _=tx.Rollback() }()

	switch item.EffectType {
	case "DELIVERY_SETTLEMENT":
		var current string
		if err := tx.QueryRowContext(ctx,`SELECT payment_state FROM dsh.commerce_orders WHERE id=$1 AND payment_intent_id=$2 FOR UPDATE`,item.OrderID,item.PaymentIntentID).Scan(&current); err != nil {
			return err
		}
		if current=="REQUIRES_COLLECTION" {
			if result,err:=tx.ExecContext(ctx,`UPDATE dsh.commerce_orders SET payment_state='COLLECTED',updated_at=clock_timestamp() WHERE id=$1 AND payment_intent_id=$2 AND payment_state='REQUIRES_COLLECTION'`,item.OrderID,item.PaymentIntentID);err!=nil{
				return err
			}else if rows,err:=result.RowsAffected();err!=nil||rows!=1{
				if err!=nil{return err}
				return ErrPaymentStateConflict
			}
		} else if current!="COLLECTED" {
			return ErrPaymentStateConflict
		}
		if _,err:=tx.ExecContext(ctx,`INSERT INTO dsh.commerce_order_payment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,payment_intent_id,from_state,to_state,amount_minor)
			VALUES('payment_collected',$1,$2,$3,$4,$5,'REQUIRES_COLLECTION','COLLECTED',$6)
			ON CONFLICT (event_type,idempotency_key) DO NOTHING`,item.IdempotencyKey,item.CorrelationID,item.ActingActorID,item.OrderID,item.PaymentIntentID,item.AmountMinor);err!=nil{return err}
	case "PAYMENT_CANCEL":
		var current string
		if err := tx.QueryRowContext(ctx,`SELECT payment_state FROM dsh.commerce_orders WHERE id=$1 AND payment_intent_id=$2 FOR UPDATE`,item.OrderID,item.PaymentIntentID).Scan(&current); err != nil {
			return err
		}
		if current=="REQUIRES_COLLECTION" {
			if result,err:=tx.ExecContext(ctx,`UPDATE dsh.commerce_orders SET payment_state='CANCELLED',updated_at=clock_timestamp() WHERE id=$1 AND payment_intent_id=$2 AND payment_state='REQUIRES_COLLECTION'`,item.OrderID,item.PaymentIntentID);err!=nil{
				return err
			}else if rows,err:=result.RowsAffected();err!=nil||rows!=1{
				if err!=nil{return err}
				return ErrPaymentStateConflict
			}
		} else if current!="CANCELLED" {
			return ErrPaymentStateConflict
		}
		if _,err:=tx.ExecContext(ctx,`INSERT INTO dsh.commerce_order_payment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,payment_intent_id,from_state,to_state,amount_minor)
			VALUES('payment_cancelled',$1,$2,$3,$4,$5,'REQUIRES_COLLECTION','CANCELLED',$6)
			ON CONFLICT (event_type,idempotency_key) DO NOTHING`,item.IdempotencyKey,item.CorrelationID,item.ActingActorID,item.OrderID,item.PaymentIntentID,item.AmountMinor);err!=nil{return err}
	case "CAPTAIN_COD_RELEASE":
	default:
		return errors.New("unknown financial handoff effect")
	}
	if _,err:=tx.ExecContext(ctx,`UPDATE dsh.commerce_financial_handoff_outbox SET state='POSTED',attempts=attempts+1,last_error=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND state<>'POSTED'`,item.ID);err!=nil{return err}
	return tx.Commit()
}
