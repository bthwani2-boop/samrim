package wallet

import (
	"context"
	"database/sql"
	"errors"
)

type allocationReader func(context.Context, string, string) (allocationReadback, error)

type allocationReadback struct {
	ActorID    string             `json:"actorId"`
	CheckoutID string             `json:"checkoutId"`
	Allocation *paymentAllocation `json:"allocation"`
}

type paymentAllocation struct {
	StoreID   string `json:"storeId"`
	Method    string `json:"method"`
	TotalYER  string `json:"totalYer"`
	WalletYER string `json:"walletYer"`
	CashYER   string `json:"cashYer"`
	Currency  string `json:"currency"`
	State     string `json:"state"`
}

// Absent and another Customer's checkout have identical owner read semantics.
// The allocation and release are read in one PostgreSQL statement/snapshot.
func readOrderPaymentAllocation(ctx context.Context, db *sql.DB, actor, checkout string) (allocationReadback, error) {
	result := allocationReadback{ActorID: actor, CheckoutID: checkout}
	var a paymentAllocation
	err := db.QueryRowContext(ctx, `SELECT store_id,method,total_yer::text,wallet_yer::text,cash_yer::text,currency,state
		FROM wlt.customer_order_payment_readback WHERE actor_id=$1 AND checkout_id=$2`, actor, checkout).
		Scan(&a.StoreID, &a.Method, &a.TotalYER, &a.WalletYER, &a.CashYER, &a.Currency, &a.State)
	if errors.Is(err, sql.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.Allocation = &a
	return result, nil
}
