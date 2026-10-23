package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Evidence candidates are always rechecked during RESOLVE. No financial
// balance, customer data, precise GPS, or unposted outbox row is exposed.
type OpsCaseResolutionEvidence struct {
	Reference   string    `json:"reference"`
	Kind        string    `json:"kind"`
	ConfirmedAt time.Time `json:"confirmedAt"`
}

func ListOrderCaseResolutionEvidence(ctx context.Context, db *sql.DB, orderID string, caseID int64) ([]OpsCaseResolutionEvidence, error) {
	out := []OpsCaseResolutionEvidence{}
	orderID = strings.TrimSpace(orderID)
	if db == nil || orderID == "" || len(orderID) > 128 || caseID <= 0 {
		return out, ErrOpsCaseInvalid
	}
	var reason, state string
	err := db.QueryRowContext(ctx, `SELECT reason,state FROM dsh.operator_order_cases
  WHERE order_id=$1 AND id=$2`, orderID, caseID).Scan(&reason, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrOpsCaseNotFound
	}
	if err != nil {
		return out, err
	}
	if state == "RESOLVED" {
		return out, nil
	}
	var prefix, query string
	switch reason {
	case "PAYMENT_EXCEPTION":
		prefix = "financial_handoff:"
		query = `SELECT f.id,f.effect_type,f.updated_at
   FROM dsh.commerce_financial_handoff_outbox f
   WHERE f.order_id=$1 AND f.state='POSTED'
    AND f.effect_type IN ('PAYMENT_CANCEL','ORDER_ADJUSTMENT_RECONCILIATION')
   ORDER BY f.updated_at DESC,f.id DESC LIMIT 12`
	case "DELIVERY_BLOCKED":
		prefix = "delivery_completed:"
		query = `SELECT a.id::text,a.event_type,a.created_at
   FROM dsh.captain_audit a
   WHERE a.order_id=$1 AND a.event_type='delivery_completed'
   ORDER BY a.created_at DESC,a.id DESC LIMIT 12`
	default:
		return out, nil
	}
	rows, err := db.QueryContext(ctx, query, orderID)
	if err != nil {
		return out, err
	}
	candidates := make([]OpsCaseResolutionEvidence, 0, 12)
	for rows.Next() {
		var id, kind string
		var confirmedAt time.Time
		if err := rows.Scan(&id, &kind, &confirmedAt); err != nil {
			_ = rows.Close()
			return out, err
		}
		candidates = append(candidates, OpsCaseResolutionEvidence{
			Reference: prefix + id, Kind: kind, ConfirmedAt: confirmedAt,
		})
	}
	if err = rows.Err(); err != nil {
		_ = rows.Close()
		return out, err
	}
	if err = rows.Close(); err != nil {
		return out, err
	}
	for _, candidate := range candidates {
		tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
		if err != nil {
			return out, err
		}
		validation := verifyOperatorCaseResolutionProof(ctx, tx, orderID, reason, candidate.Reference)
		_ = tx.Rollback()
		if errors.Is(validation, ErrOpsCaseUnverified) {
			continue
		}
		if validation != nil {
			return out, validation
		}
		out = append(out, candidate)
	}
	return out, nil
}
