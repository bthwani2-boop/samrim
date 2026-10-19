package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

var ErrPromotionSettlementSummaryInput = errors.New("promotion settlement summary input is invalid")

// PromotionSettlementSummary reports finalized economic allocations, not
// impressions, checkout reservations, gross order creations or net refunds.
// PlatformPostedExpenseMinor is grounded in the WLT ledger account.
type PromotionSettlementSummary struct {
	PromotionID                string `json:"promotionId"`
	SettledOrderCount          int64  `json:"settledOrderCount"`
	SettledDiscountMinor       int64  `json:"settledDiscountMinor"`
	PartnerFundedMinor         int64  `json:"partnerFundedMinor"`
	PlatformFrozenMinor        int64  `json:"platformFrozenMinor"`
	PlatformPostedExpenseMinor int64  `json:"platformPostedExpenseMinor"`
	Currency                   string `json:"currency"`
	Basis                      string `json:"basis"`
}

func ReadPromotionSettlementSummary(ctx context.Context, db *sql.DB, promotionID string) (PromotionSettlementSummary, error) {
	promotionID = strings.TrimSpace(promotionID)
	if db == nil || promotionID == "" || len(promotionID) > 128 {
		return PromotionSettlementSummary{}, ErrPromotionSettlementSummaryInput
	}
	result := PromotionSettlementSummary{PromotionID: promotionID, Currency: "YER", Basis: "POSTED_SETTLEMENT_NOT_NET_REFUNDS"}
	const query = `
WITH settled_orders AS (
    SELECT order_id FROM wlt.partner_order_earnings
    UNION
    SELECT order_id FROM wlt.partner_store_cash_commissions
), per_order AS (
    SELECT funding.order_id, funding.discount_minor, funding.partner_funded_minor, funding.bthwani_funded_minor,
           COALESCE((
              SELECT SUM(CASE WHEN entry.direction='DEBIT' THEN entry.amount_minor ELSE -entry.amount_minor END)
              FROM wlt.ledger_transactions txn
              JOIN wlt.ledger_entries entry ON entry.transaction_id=txn.id
              WHERE txn.source_id=funding.order_id
                AND txn.source_type IN ('ORDER_DELIVERED','PARTNER_STORE_CASH_COMMISSION')
                AND entry.account_code='BTHWANI_PROMOTION_EXPENSE'
           ),0) AS posted_expense
    FROM wlt.order_promotion_funding funding
    JOIN settled_orders settled ON settled.order_id=funding.order_id
    WHERE funding.kind='ORDER' AND funding.promotion_id=$1
)
SELECT COUNT(*), COALESCE(SUM(discount_minor),0), COALESCE(SUM(partner_funded_minor),0),
       COALESCE(SUM(bthwani_funded_minor),0), COALESCE(SUM(posted_expense),0)
FROM per_order`
	err := db.QueryRowContext(ctx, query, promotionID).Scan(&result.SettledOrderCount, &result.SettledDiscountMinor,
		&result.PartnerFundedMinor, &result.PlatformFrozenMinor, &result.PlatformPostedExpenseMinor)
	if err != nil {
		return PromotionSettlementSummary{}, err
	}
	return result, nil
}
