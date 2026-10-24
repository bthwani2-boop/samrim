package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/lib/pq"
)

var ErrPartnerActivityInput = errors.New("partner financial activity query is invalid")

// PartnerActivity is a store-attributed, read-only projection of immutable WLT
// earning/commission records and payout allocations, not an order-price estimate.
type PartnerActivity struct {
	ID                  string    `json:"id"`
	Kind                string    `json:"kind"`
	StoreID             string    `json:"storeId"`
	Status              string    `json:"status"`
	PaymentMethod       string    `json:"paymentMethod"`
	Direction           string    `json:"direction"`
	GrossMinor          int64     `json:"grossMinor"`
	CommissionMinor     int64     `json:"commissionMinor"`
	OffsetMinor         int64     `json:"offsetMinor"`
	AmountMinor         int64     `json:"amountMinor"`
	Currency            string    `json:"currency"`
	LedgerTransactionID string    `json:"ledgerTransactionId"`
	CreatedAt           time.Time `json:"createdAt"`
}

type PartnerActivityQuery struct {
	StoreIDs      []string
	Kind          string
	Status        string
	PaymentMethod string
	Search        string
	From          time.Time
	To            time.Time // exclusive, UTC
	CursorAt      *time.Time
	CursorKind    string
	CursorID      string
	Limit         int
}
type PartnerActivityPage struct {
	Items      []PartnerActivity `json:"items"`
	NextCursor string            `json:"nextCursor,omitempty"`
}

// ListPartnerActivity never returns unscoped records. The DSH caller establishes
// the authorized store list first; WLT additionally verifies owner attribution.
func ListPartnerActivity(ctx context.Context, db *sql.DB, owner string, q PartnerActivityQuery) (PartnerActivityPage, error) {
	owner = strings.TrimSpace(owner)
	if db == nil || owner == "" || len(owner) > 128 || len(q.StoreIDs) == 0 || q.Limit < 1 || q.Limit > 100 ||
		len(q.Search) > 128 || len(q.CursorKind) > 32 || len(q.CursorID) > 300 ||
		(q.CursorAt == nil && (q.CursorKind != "" || q.CursorID != "")) ||
		(q.CursorAt != nil && (q.CursorKind == "" || q.CursorID == "")) ||
		(!q.To.IsZero() && !q.From.IsZero() && !q.To.After(q.From)) {
		return PartnerActivityPage{}, ErrPartnerActivityInput
	}
	for _, id := range q.StoreIDs {
		if strings.TrimSpace(id) == "" || len(id) > 128 {
			return PartnerActivityPage{}, ErrPartnerActivityInput
		}
	}
	if q.Kind != "" && q.Kind != "ORDER" && q.Kind != "CASH_COMMISSION" && q.Kind != "PAYOUT" {
		return PartnerActivityPage{}, ErrPartnerActivityInput
	}
	if q.PaymentMethod != "" && q.PaymentMethod != "CASH_ON_DELIVERY" && q.PaymentMethod != "CASH_AT_STORE" && q.PaymentMethod != "WALLET" && q.PaymentMethod != "MIXED" {
		return PartnerActivityPage{}, ErrPartnerActivityInput
	}
	if q.Status != "" && q.Status != "POSTED" && q.Status != "COMPLETED" && q.Status != "PENDING" && q.Status != "CANCELLED" && q.Status != "EXCEPTION" {
		return PartnerActivityPage{}, ErrPartnerActivityInput
	}
	// Each source is unique by (kind,id); payout lines are keyed by payout+store.
	// Pending payouts are holds, not debits, and cash commissions are receivables,
	// not deductions from the merchant's available wallet balance.
	const sqlText = `WITH movements AS (
        SELECT e.order_id id,'ORDER' kind,e.store_id,e.created_at,'POSTED' status,
            COALESCE(p.method,'') payment_method,'CREDIT' direction,
            e.gross_product_minor gross_minor,e.commission_minor commission_minor,
            e.commission_receivable_offset_minor offset_minor,
            e.partner_net_minor-e.commission_receivable_offset_minor amount_minor,
            e.currency, e.ledger_transaction_id ledger_transaction_id
        FROM wlt.partner_order_earnings e
        LEFT JOIN wlt.payment_intents p ON p.id=e.payment_intent_id
        WHERE e.partner_actor_id=$1 AND e.store_id=ANY($2)
        UNION ALL
        SELECT c.order_id,'CASH_COMMISSION',a.store_id,c.created_at,'POSTED',
            COALESCE(p.method,''),'RECEIVABLE',c.gross_product_minor,c.commission_minor,0,
            c.commission_minor,c.currency,COALESCE(c.ledger_transaction_id,'')
        FROM wlt.partner_store_cash_commissions c
        JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=c.payment_intent_id
        LEFT JOIN wlt.payment_intents p ON p.id=c.payment_intent_id
        WHERE c.partner_actor_id=$1 AND a.store_id=ANY($2)
        UNION ALL
        SELECT p.id || ':' || a.store_id,'PAYOUT',a.store_id,p.created_at,
            p.status,'',CASE WHEN p.status='COMPLETED' THEN 'DEBIT' ELSE 'HOLD' END,
            0,0,0,a.amount_minor,a.currency,''
        FROM wlt.payout_store_allocations a
        JOIN wlt.payout_requests p ON p.id=a.payout_id
        WHERE p.actor_type='partner' AND p.actor_id=$1 AND a.store_id=ANY($2)
    )
    SELECT id,kind,store_id,created_at,status,payment_method,direction,gross_minor,
           commission_minor,offset_minor,amount_minor,currency,ledger_transaction_id
    FROM movements
    WHERE ($3='' OR kind=$3) AND ($4='' OR
        CASE WHEN $4='PENDING' THEN status IN ('HELD','PREPARED','APPROVED','FROZEN','EXECUTED')
        WHEN $4='EXCEPTION' THEN status='EXCEPTION' ELSE status=$4 END)
      AND ($5='' OR payment_method=$5)
      AND ($6='' OR id ILIKE '%' || $6 || '%')
      AND ($7::timestamptz IS NULL OR created_at >= $7)
      AND ($8::timestamptz IS NULL OR created_at < $8)
      AND ($9::timestamptz IS NULL OR (created_at,kind,id) < ($9,$10,$11))
    ORDER BY created_at DESC,kind DESC,id DESC LIMIT $12`
	var from, to, cursor any
	if !q.From.IsZero() {
		from = q.From.UTC()
	}
	if !q.To.IsZero() {
		to = q.To.UTC()
	}
	if q.CursorAt != nil {
		cursor = q.CursorAt.UTC()
	}
	rows, err := db.QueryContext(ctx, sqlText, owner, pq.Array(q.StoreIDs), q.Kind, q.Status,
		q.PaymentMethod, strings.TrimSpace(q.Search), from, to, cursor, q.CursorKind, q.CursorID, q.Limit+1)
	if err != nil {
		return PartnerActivityPage{}, err
	}
	defer rows.Close()
	page := PartnerActivityPage{Items: make([]PartnerActivity, 0, q.Limit)}
	for rows.Next() {
		var item PartnerActivity
		if err := rows.Scan(&item.ID, &item.Kind, &item.StoreID, &item.CreatedAt, &item.Status,
			&item.PaymentMethod, &item.Direction, &item.GrossMinor, &item.CommissionMinor,
			&item.OffsetMinor, &item.AmountMinor, &item.Currency, &item.LedgerTransactionID); err != nil {
			return PartnerActivityPage{}, err
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return PartnerActivityPage{}, err
	}
	if len(page.Items) > q.Limit {
		last := page.Items[q.Limit-1]
		page.NextCursor = last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + last.Kind + "|" + last.ID
		page.Items = page.Items[:q.Limit]
	}
	return page, nil
}
