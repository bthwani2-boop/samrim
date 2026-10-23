package postgres

import (
	"context"
	"database/sql"
	"strings"
)

// Evidence points to an actual DSH/WLT acknowledged owner event.
func verifyOperatorCaseResolutionProof(ctx context.Context, tx *sql.Tx, orderID, reason, evidenceRef string) error {
	if tx == nil || evidenceRef == "" || len(evidenceRef) > 128 {
		return ErrOpsCaseUnverified
	}
	var confirmed bool
	switch reason {
	case "PAYMENT_EXCEPTION":
		if !strings.HasPrefix(evidenceRef, "financial_handoff:") {
			return ErrOpsCaseUnverified
		}
		ref := strings.TrimPrefix(evidenceRef, "financial_handoff:")
		if ref == "" {
			return ErrOpsCaseUnverified
		}
		err := tx.QueryRowContext(ctx, `SELECT EXISTS(
   SELECT 1 FROM dsh.commerce_financial_handoff_outbox f
   JOIN dsh.commerce_orders o ON o.id=f.order_id AND o.payment_intent_id=f.payment_intent_id
   WHERE f.id=$2 AND f.order_id=$1 AND f.state='POSTED'
    AND (f.effect_type='ORDER_ADJUSTMENT_RECONCILIATION' OR (f.effect_type='PAYMENT_CANCEL' AND o.payment_state='CANCELLED'))
  ) AND NOT EXISTS(
   SELECT 1 FROM dsh.commerce_financial_handoff_outbox f
   WHERE f.order_id=$1 AND f.state<>'POSTED'
  )`, orderID, ref).Scan(&confirmed)
		if err != nil {
			return err
		}
	case "DELIVERY_BLOCKED":
		if !strings.HasPrefix(evidenceRef, "delivery_completed:") {
			return ErrOpsCaseUnverified
		}
		ref := strings.TrimPrefix(evidenceRef, "delivery_completed:")
		if ref == "" {
			return ErrOpsCaseUnverified
		}
		err := tx.QueryRowContext(ctx, `SELECT EXISTS(
   SELECT 1 FROM dsh.captain_audit a
   JOIN dsh.commerce_orders o ON o.id=a.order_id
   JOIN dsh.commerce_order_delivery_proofs p ON p.order_id=o.id
   WHERE a.order_id=$1 AND a.id::text=$2 AND a.event_type='delivery_completed'
    AND o.state='DELIVERED' AND p.state='VERIFIED'
  ) AND NOT EXISTS(
   SELECT 1 FROM dsh.commerce_financial_handoff_outbox f
   WHERE f.order_id=$1 AND f.state<>'POSTED'
  )`, orderID, ref).Scan(&confirmed)
		if err != nil {
			return err
		}
	default:
		return ErrOpsCaseInvalid
	}
	if !confirmed {
		return ErrOpsCaseUnverified
	}
	return nil
}
