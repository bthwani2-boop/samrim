package postgres

import (
	"context"
	"database/sql"
	"strings"
)

// ListRecentCustomerWalletCompensations returns only immutable, committed
// credits scoped to the customer. Pending reconciliation is never shown as money.
func ListRecentCustomerWalletCompensations(ctx context.Context, db *sql.DB, customerID string, limit int) ([]CustomerWalletCompensationRecord, error) {
	customerID = strings.TrimSpace(customerID)
	if db == nil || customerID == "" || len(customerID) > 128 || limit < 1 || limit > 20 {
		return nil, ErrCustomerWalletCompensationInput
	}
	rows, err := db.QueryContext(ctx, `SELECT case_id,order_id,customer_actor_id,amount_minor,
        'YER',approved_by_actor_id,evidence_reference,ledger_transaction_id,created_at
        FROM wlt.customer_wallet_compensations
        WHERE customer_actor_id=$1 ORDER BY created_at DESC,case_id DESC LIMIT $2`, customerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]CustomerWalletCompensationRecord, 0)
	for rows.Next() {
		var item CustomerWalletCompensationRecord
		if err := rows.Scan(&item.CaseID, &item.OrderID, &item.CustomerActorID, &item.AmountMinor,
			&item.Currency, &item.ApprovedByActorID, &item.EvidenceReference,
			&item.LedgerTransactionID, &item.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
