package postgres

import (
	"context"
	"database/sql"
	"errors"
	"math/big"
	"strings"
	"time"
)

var (
	ErrCustomerPaymentAllocationInvalidInput = errors.New("customer payment allocation input is invalid")
	ErrCustomerPaymentAllocationNotFound     = errors.New("customer payment allocation was not found")
)

type CustomerPaymentAllocationInput struct {
	OrderID, Currency                                                                                                 string
	SubtotalMinor, DeliveryFeeMinor, DiscountMinor, InternalBalanceAmountMinor, CashAmountMinor, CustomerPayableMinor int64
	PolicyVersion                                                                                                     string
}
type CustomerPaymentAllocationRecord struct {
	ID, OrderID, PaymentIntentID, Currency                                                                            string
	SubtotalMinor, DeliveryFeeMinor, DiscountMinor, InternalBalanceAmountMinor, CashAmountMinor, CustomerPayableMinor int64
	PolicyVersion                                                                                                     string
	CreatedAt                                                                                                         time.Time
}

func validateCustomerPaymentAllocation(i CustomerPaymentAllocationInput) error {
	if strings.TrimSpace(i.OrderID) == "" || strings.TrimSpace(i.Currency) != "YER" || strings.TrimSpace(i.PolicyVersion) == "" || i.CustomerPayableMinor <= 0 {
		return ErrCustomerPaymentAllocationInvalidInput
	}
	for _, v := range []int64{i.SubtotalMinor, i.DeliveryFeeMinor, i.DiscountMinor, i.InternalBalanceAmountMinor, i.CashAmountMinor} {
		if v < 0 {
			return ErrCustomerPaymentAllocationInvalidInput
		}
	}
	p := new(big.Int).Add(big.NewInt(i.SubtotalMinor), big.NewInt(i.DeliveryFeeMinor))
	p.Sub(p, big.NewInt(i.DiscountMinor))
	if !p.IsInt64() || p.Sign() <= 0 || p.Int64() != i.CustomerPayableMinor {
		return ErrCustomerPaymentAllocationInvalidInput
	}
	f := new(big.Int).Add(big.NewInt(i.InternalBalanceAmountMinor), big.NewInt(i.CashAmountMinor))
	if !f.IsInt64() || f.Int64() != i.CustomerPayableMinor {
		return ErrCustomerPaymentAllocationInvalidInput
	}
	return nil
}
func readCustomerPaymentAllocation(ctx context.Context, s interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, pid string) (CustomerPaymentAllocationRecord, error) {
	var a CustomerPaymentAllocationRecord
	err := s.QueryRowContext(ctx, `SELECT id,order_id,payment_intent_id,currency,subtotal_minor,delivery_fee_minor,discount_minor,internal_balance_amount_minor,cash_amount_minor,customer_payable_minor,policy_version,created_at FROM wlt.customer_payment_allocations WHERE payment_intent_id=$1`, pid).Scan(&a.ID, &a.OrderID, &a.PaymentIntentID, &a.Currency, &a.SubtotalMinor, &a.DeliveryFeeMinor, &a.DiscountMinor, &a.InternalBalanceAmountMinor, &a.CashAmountMinor, &a.CustomerPayableMinor, &a.PolicyVersion, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CustomerPaymentAllocationRecord{}, ErrCustomerPaymentAllocationNotFound
	}
	return a, err
}
func insertCustomerPaymentAllocationTx(ctx context.Context, tx *sql.Tx, i CustomerPaymentAllocationInput, pid, key, hash, corr string) (CustomerPaymentAllocationRecord, error) {
	id, err := newID("customer-payment-allocation")
	if err != nil {
		return CustomerPaymentAllocationRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.customer_payment_allocations(id,order_id,payment_intent_id,currency,subtotal_minor,delivery_fee_minor,discount_minor,internal_balance_amount_minor,cash_amount_minor,customer_payable_minor,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, i.OrderID, pid, i.Currency, i.SubtotalMinor, i.DeliveryFeeMinor, i.DiscountMinor, i.InternalBalanceAmountMinor, i.CashAmountMinor, i.CustomerPayableMinor, i.PolicyVersion); err != nil {
		return CustomerPaymentAllocationRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.customer_payment_allocation_events(allocation_id,event_type,order_id,payment_intent_id,request_hash,idempotency_key,correlation_id) VALUES($1,'CUSTOMER_PAYMENT_ALLOCATION_CREATED',$2,$3,$4,$5,$6)`, id, i.OrderID, pid, hash, key, corr); err != nil {
		return CustomerPaymentAllocationRecord{}, err
	}
	return CustomerPaymentAllocationRecord{ID: id, OrderID: i.OrderID, PaymentIntentID: pid, Currency: i.Currency, SubtotalMinor: i.SubtotalMinor, DeliveryFeeMinor: i.DeliveryFeeMinor, DiscountMinor: i.DiscountMinor, InternalBalanceAmountMinor: i.InternalBalanceAmountMinor, CashAmountMinor: i.CashAmountMinor, CustomerPayableMinor: i.CustomerPayableMinor, PolicyVersion: i.PolicyVersion}, nil
}
