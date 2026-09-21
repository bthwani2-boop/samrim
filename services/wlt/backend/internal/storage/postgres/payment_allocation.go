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
	ErrPaymentAllocationInvalidInput = errors.New("payment allocation input is invalid")
	ErrPaymentAllocationNotFound     = errors.New("payment allocation was not found")
)

type PaymentAllocationInput struct {
	OrderID                           string
	Currency                          string
	SubtotalMinor                     int64
	DeliveryFeeMinor                  int64
	DiscountMinor                     int64
	PlatformSubsidyMinor              int64
	InternalWalletAmountMinor         int64
	ExternalOfficialWalletAmountMinor int64
	CashAmountMinor                   int64
	CODProductAmountMinor             int64
	CODDeliveryAmountMinor            int64
	TotalMinor                        int64
	PolicyVersion                     string
}

type PaymentAllocationRecord struct {
	ID                                string
	OrderID                           string
	PaymentIntentID                   string
	Currency                          string
	SubtotalMinor                     int64
	DeliveryFeeMinor                  int64
	DiscountMinor                     int64
	PlatformSubsidyMinor              int64
	InternalWalletAmountMinor         int64
	ExternalOfficialWalletAmountMinor int64
	CashAmountMinor                   int64
	CODProductAmountMinor             int64
	CODDeliveryAmountMinor            int64
	TotalMinor                        int64
	PolicyVersion                     string
	CreatedAt                         time.Time
}

func validatePaymentAllocation(input PaymentAllocationInput) error {
	if strings.TrimSpace(input.OrderID) == "" || strings.TrimSpace(input.Currency) != "YER" || strings.TrimSpace(input.PolicyVersion) == "" || input.TotalMinor <= 0 {
		return ErrPaymentAllocationInvalidInput
	}
	amounts := []int64{input.SubtotalMinor, input.DeliveryFeeMinor, input.DiscountMinor, input.PlatformSubsidyMinor, input.InternalWalletAmountMinor, input.ExternalOfficialWalletAmountMinor, input.CashAmountMinor, input.CODProductAmountMinor, input.CODDeliveryAmountMinor}
	for _, amount := range amounts {
		if amount < 0 {
			return ErrPaymentAllocationInvalidInput
		}
	}
	componentsTotal := new(big.Int).Add(big.NewInt(input.SubtotalMinor), big.NewInt(input.DeliveryFeeMinor))
	componentsTotal.Sub(componentsTotal, big.NewInt(input.DiscountMinor))
	if !componentsTotal.IsInt64() || componentsTotal.Int64() != input.TotalMinor {
		return ErrPaymentAllocationInvalidInput
	}
	conservation := new(big.Int).Add(big.NewInt(input.InternalWalletAmountMinor), big.NewInt(input.ExternalOfficialWalletAmountMinor))
	conservation.Add(conservation, big.NewInt(input.CashAmountMinor))
	conservation.Add(conservation, big.NewInt(input.PlatformSubsidyMinor))
	if !conservation.IsInt64() || conservation.Int64() != input.TotalMinor {
		return ErrPaymentAllocationInvalidInput
	}
	if input.CODProductAmountMinor+input.CODDeliveryAmountMinor < input.CODProductAmountMinor || input.CODProductAmountMinor+input.CODDeliveryAmountMinor != input.CashAmountMinor {
		return ErrPaymentAllocationInvalidInput
	}
	return nil
}

func readPaymentAllocation(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, paymentIntentID string) (PaymentAllocationRecord, error) {
	var allocation PaymentAllocationRecord
	err := source.QueryRowContext(ctx, `SELECT id,order_id,payment_intent_id,currency,subtotal_minor,delivery_fee_minor,discount_minor,platform_subsidy_minor,internal_wallet_amount_minor,external_official_wallet_amount_minor,cash_amount_minor,cod_product_amount_minor,cod_delivery_amount_minor,total_minor,policy_version,created_at FROM wlt.payment_allocations WHERE payment_intent_id=$1`, paymentIntentID).Scan(&allocation.ID, &allocation.OrderID, &allocation.PaymentIntentID, &allocation.Currency, &allocation.SubtotalMinor, &allocation.DeliveryFeeMinor, &allocation.DiscountMinor, &allocation.PlatformSubsidyMinor, &allocation.InternalWalletAmountMinor, &allocation.ExternalOfficialWalletAmountMinor, &allocation.CashAmountMinor, &allocation.CODProductAmountMinor, &allocation.CODDeliveryAmountMinor, &allocation.TotalMinor, &allocation.PolicyVersion, &allocation.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PaymentAllocationRecord{}, ErrPaymentAllocationNotFound
	}
	return allocation, err
}

func insertPaymentAllocationTx(ctx context.Context, tx *sql.Tx, input PaymentAllocationInput, paymentIntentID, idempotencyKey, requestHash, correlationID string) (PaymentAllocationRecord, error) {
	allocationID, err := newID("allocation")
	if err != nil {
		return PaymentAllocationRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payment_allocations(id,order_id,payment_intent_id,currency,subtotal_minor,delivery_fee_minor,discount_minor,platform_subsidy_minor,internal_wallet_amount_minor,external_official_wallet_amount_minor,cash_amount_minor,cod_product_amount_minor,cod_delivery_amount_minor,total_minor,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, allocationID, input.OrderID, paymentIntentID, input.Currency, input.SubtotalMinor, input.DeliveryFeeMinor, input.DiscountMinor, input.PlatformSubsidyMinor, input.InternalWalletAmountMinor, input.ExternalOfficialWalletAmountMinor, input.CashAmountMinor, input.CODProductAmountMinor, input.CODDeliveryAmountMinor, input.TotalMinor, input.PolicyVersion); err != nil {
		return PaymentAllocationRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payment_allocation_events(allocation_id,event_type,order_id,payment_intent_id,request_hash,idempotency_key,correlation_id) VALUES($1,'PAYMENT_ALLOCATION_CREATED',$2,$3,$4,$5,$6)`, allocationID, input.OrderID, paymentIntentID, requestHash, idempotencyKey, correlationID); err != nil {
		return PaymentAllocationRecord{}, err
	}
	return PaymentAllocationRecord{ID: allocationID, OrderID: input.OrderID, PaymentIntentID: paymentIntentID, Currency: input.Currency, SubtotalMinor: input.SubtotalMinor, DeliveryFeeMinor: input.DeliveryFeeMinor, DiscountMinor: input.DiscountMinor, PlatformSubsidyMinor: input.PlatformSubsidyMinor, InternalWalletAmountMinor: input.InternalWalletAmountMinor, ExternalOfficialWalletAmountMinor: input.ExternalOfficialWalletAmountMinor, CashAmountMinor: input.CashAmountMinor, CODProductAmountMinor: input.CODProductAmountMinor, CODDeliveryAmountMinor: input.CODDeliveryAmountMinor, TotalMinor: input.TotalMinor, PolicyVersion: input.PolicyVersion}, nil
}
