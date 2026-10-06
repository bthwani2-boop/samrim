package postgres

import (
	"context"
	"database/sql"
	"strings"

	"github.com/lib/pq"
)

// PartnerStoreFinanceRecord is a projection of the existing earnings, ledger
// and payout allocations. It is also the amount source for payout creation.
type PartnerStoreFinanceRecord struct {
	AttributionComplete        bool   `json:"attributionComplete"`
	StoreID                    string `json:"storeId"`
	PartnerActorID             string `json:"partnerActorId"`
	Currency                   string `json:"currency"`
	EarnedMinor                int64  `json:"earnedMinor"`
	CommissionMinor            int64  `json:"commissionMinor"`
	OrderCount                 int64  `json:"orderCount"`
	EligibleAvailableMinor     int64  `json:"eligibleAvailableMinor"`
	HeldMinor                  int64  `json:"heldMinor"`
	SettledMinor               int64  `json:"settledMinor"`
	RecipientState             string `json:"recipientState"`
	BeneficiaryActorID         string `json:"beneficiaryActorId"`
	RecipientAssignmentVersion int64  `json:"recipientAssignmentVersion"`
	PayoutReady                bool   `json:"payoutReady"`
}

func readPartnerStoreFinance(ctx context.Context, tx *sql.Tx, partnerActorID string, storeIDs []string) ([]PartnerStoreFinanceRecord, error) {
	if storeIDs == nil {
		storeIDs = []string{}
	}
	rows, err := tx.QueryContext(ctx, `WITH earnings AS (
		SELECT store_id,SUM(partner_net_minor-commission_receivable_offset_minor) earned,SUM(commission_minor) commission,COUNT(*) orders
		FROM wlt.partner_order_earnings WHERE partner_actor_id=$1 GROUP BY store_id
	), cash AS (
		SELECT a.store_id,SUM(c.commission_minor) commission,COUNT(*) orders
		FROM wlt.partner_store_cash_commissions c JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=c.payment_intent_id
		WHERE c.partner_actor_id=$1 GROUP BY a.store_id
	), consumed AS (
		SELECT a.store_id,SUM(a.amount_minor) FILTER (WHERE p.status <> 'COMPLETED') held,
		SUM(a.amount_minor) FILTER (WHERE p.status='COMPLETED') settled
		FROM wlt.payout_store_allocations a JOIN wlt.payout_requests p ON p.id=a.payout_id
		WHERE p.actor_type='partner' AND p.actor_id=$1 AND p.status <> 'CANCELLED' GROUP BY a.store_id
	), stores AS (
		SELECT store_id FROM earnings UNION SELECT store_id FROM cash
		UNION SELECT store_id FROM wlt.store_payout_recipient_assignments WHERE partner_actor_id=$1
		UNION SELECT unnest($2::text[])
	)
	SELECT s.store_id,COALESCE(e.earned,0),COALESCE(e.commission,0)+COALESCE(c.commission,0),COALESCE(e.orders,0)+COALESCE(c.orders,0),
		COALESCE(u.held,0),COALESCE(u.settled,0),COALESCE(r.state,'DEFAULT_OWNER'),
		CASE WHEN r.state='SELECTED_VERIFIED_STAFF' THEN r.beneficiary_actor_id ELSE $1 END,COALESCE(r.version,0),
		COALESCE(r.state,'DEFAULT_OWNER') <> 'RECIPIENT_REVIEW_REQUIRED' AND EXISTS (
			SELECT 1 FROM wlt.official_wallet_destinations d WHERE d.actor_type='partner'
			AND d.actor_id=CASE WHEN r.state='SELECTED_VERIFIED_STAFF' THEN r.beneficiary_actor_id ELSE $1 END
			AND d.verification_status='VERIFIED' AND d.status='ACTIVE_FOR_PAYOUT')
	FROM stores s LEFT JOIN earnings e USING(store_id) LEFT JOIN cash c USING(store_id) LEFT JOIN consumed u USING(store_id)
	LEFT JOIN wlt.store_payout_recipient_assignments r ON r.store_id=s.store_id AND r.partner_actor_id=$1
	ORDER BY s.store_id`, partnerActorID, pq.Array(storeIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]PartnerStoreFinanceRecord, 0)
	for rows.Next() {
		item := PartnerStoreFinanceRecord{PartnerActorID: partnerActorID, Currency: "YER"}
		if err := rows.Scan(&item.StoreID, &item.EarnedMinor, &item.CommissionMinor, &item.OrderCount, &item.HeldMinor, &item.SettledMinor, &item.RecipientState, &item.BeneficiaryActorID, &item.RecipientAssignmentVersion, &item.PayoutReady); err != nil {
			return nil, err
		}
		item.EligibleAvailableMinor = item.EarnedMinor - item.HeldMinor - item.SettledMinor
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	var walletAvailable int64
	if err := tx.QueryRowContext(ctx, `SELECT
		COALESCE((SELECT SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END) FROM wlt.ledger_entries WHERE account_code='PARTNER_WALLET' AND actor_id=$1),0)
		-COALESCE((SELECT SUM(amount_minor) FROM wlt.payout_holds WHERE actor_type='partner' AND actor_id=$1 AND status='ACTIVE'),0)`, partnerActorID).Scan(&walletAvailable); err != nil {
		return nil, err
	}
	var attributed int64
	knownStores := true
	for _, item := range result {
		knownStores = knownStores && strings.TrimSpace(item.StoreID) != ""
		attributed += item.EligibleAvailableMinor
	}
	selected := map[string]bool{}
	for _, id := range storeIDs {
		selected[id] = true
	}
	filtered := make([]PartnerStoreFinanceRecord, 0, len(result))
	for _, item := range result {
		item.AttributionComplete = knownStores && attributed == walletAvailable
		item.PayoutReady = item.PayoutReady && item.AttributionComplete
		if len(selected) == 0 || selected[item.StoreID] {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}

func ReadPartnerStoreFinance(ctx context.Context, db *sql.DB, partnerActorID string, storeIDs []string) ([]PartnerStoreFinanceRecord, error) {
	if db == nil || strings.TrimSpace(partnerActorID) == "" {
		return nil, ErrPartnerPayoutInvalidInput
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := readPartnerStoreFinance(ctx, tx, partnerActorID, storeIDs)
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}
