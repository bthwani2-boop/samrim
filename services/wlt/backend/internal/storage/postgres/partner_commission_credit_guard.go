package postgres

import (
	"context"
	"database/sql"
	"errors"
)

var ErrPartnerCommissionCreditExceeded = errors.New("partner credit policy exceeded")

func checkPartnerCommissionCreditTx(ctx context.Context, tx *sql.Tx, i CustomerPaymentAllocationInput, snap PartnerStoreCommissionSnapshot) error {
	if i.CashAmountMinor <= 0 || (i.FulfillmentMode != "PARTNER_CAPTAIN" && i.FulfillmentMode != "CUSTOMER_PICKUP") || snap.RateBps == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-commission-balance:"+i.PartnerActorID); err != nil {
		return err
	}
	var limit int64
	var maxDays int
	var state string
	err := tx.QueryRowContext(ctx, `SELECT maximum_receivable_minor,maximum_age_days,state
 FROM wlt.partner_commission_credit_policies WHERE partner_actor_id IN ($1,'platform-default')
 ORDER BY (partner_actor_id=$1) DESC LIMIT 1 FOR SHARE`, i.PartnerActorID).Scan(&limit, &maxDays, &state)
	if err != nil {
		return err
	}
	if state != "ACTIVE" || limit < 0 || maxDays <= 0 {
		return ErrPartnerCommissionCreditExceeded
	}
	proposed, err := partnerCommissionFromSnapshot(i.SubtotalMinor, &snap)
	if err != nil {
		return err
	}
	if proposed <= 0 {
		return nil
	}
	var outstanding, pending int64
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE -amount_minor END),0)::bigint
 FROM wlt.ledger_entries WHERE account_code='PARTNER_COMMISSION_RECEIVABLE'
 AND actor_type='partner' AND actor_id=$1`, i.PartnerActorID).Scan(&outstanding)
	if err != nil {
		return err
	}
	if outstanding < 0 || outstanding > limit || proposed > limit-outstanding {
		return ErrPartnerCommissionCreditExceeded
	}
	// Unposted, uncancelled cash orders are a real potential exposure.
	// Exclude orders whose revenue has already been posted to the ledger.
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(
 CEIL(a.subtotal_minor::numeric*a.commission_rate_bps_snapshot/
 (10000*a.commission_rounding_unit_minor_snapshot))*a.commission_rounding_unit_minor_snapshot),0)::bigint
 FROM wlt.customer_payment_allocations a
 JOIN wlt.payment_intents p ON p.id=a.payment_intent_id
 WHERE a.partner_actor_id_snapshot=$1 AND a.cash_amount_minor>0
 AND a.fulfillment_mode IN ('CUSTOMER_PICKUP','PARTNER_CAPTAIN')
 AND a.commission_rate_bps_snapshot>0 AND a.commission_rounding_unit_minor_snapshot>0
 AND p.state NOT IN ('CANCELLED','CANCELED')
 AND NOT EXISTS(SELECT 1 FROM wlt.partner_store_cash_commissions c WHERE c.order_id=a.order_id)
 AND NOT EXISTS(SELECT 1 FROM wlt.partner_order_earnings e WHERE e.order_id=a.order_id)`, i.PartnerActorID).Scan(&pending)
	if err != nil {
		return err
	}
	if pending < 0 || pending > limit-outstanding || proposed > limit-outstanding-pending {
		return ErrPartnerCommissionCreditExceeded
	}
	var overdue bool
	err = tx.QueryRowContext(ctx, `WITH debits AS (
  SELECT t.created_at,
  SUM(e.amount_minor) OVER (
   ORDER BY t.created_at,e.transaction_id,e.line_sequence
   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS accrued
  FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id
  WHERE e.actor_type='partner' AND e.actor_id=$1
   AND e.account_code='PARTNER_COMMISSION_RECEIVABLE' AND e.direction='DEBIT'
 ), paid AS (
  SELECT COALESCE(SUM(amount_minor),0) AS minor FROM wlt.ledger_entries
  WHERE actor_type='partner' AND actor_id=$1
  AND account_code='PARTNER_COMMISSION_RECEIVABLE' AND direction='CREDIT'
 )
 SELECT EXISTS(SELECT 1 FROM debits,paid WHERE debits.accrued>paid.minor
 AND debits.created_at<clock_timestamp()-($2::int*interval '1 day'))`,
		i.PartnerActorID, maxDays).Scan(&overdue)
	if err != nil {
		return err
	}
	if overdue {
		return ErrPartnerCommissionCreditExceeded
	}
	return nil
}
