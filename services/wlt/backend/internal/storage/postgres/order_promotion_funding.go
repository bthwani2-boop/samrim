package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrPromotionFundingInvalidInput = errors.New("order promotion funding input is invalid")
)

// PromotionFundingInput carries the frozen promotion facts from the checkout
// order. The monetary split is derived server-side from the funding source and
// share; client amounts are never trusted.
type PromotionFundingInput struct {
	PromotionID         string
	PromotionVersion    int
	PromotionCode       string
	StoreID             string
	FundingSource       string
	PartnerSharePercent *int
	DiscountMinor       int64
}

// OrderPromotionFundingRecord is the canonical WLT funding truth for one order.
type OrderPromotionFundingRecord struct {
	ID                 string
	OrderID            string
	PaymentIntentID    string
	PromotionID        string
	PromotionVersion   int
	PromotionCode      string
	StoreID            string
	DiscountMinor      int64
	FundingSource      string
	PartnerSharePct    *int
	PartnerFundedMinor int64
	BthwaniFundedMinor int64
	Currency           string
	Kind               string
}

// freezeOrderPromotionFundingTx derives the exact Partner/BTHWANI split and
// writes the immutable funding row inside the caller's transaction.
func freezeOrderPromotionFundingTx(ctx context.Context, tx *sql.Tx, orderID, paymentIntentID string, input PromotionFundingInput) error {
	input.PromotionID = strings.TrimSpace(input.PromotionID)
	input.PromotionCode = strings.TrimSpace(input.PromotionCode)
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.FundingSource = strings.ToUpper(strings.TrimSpace(input.FundingSource))
	if tx == nil || orderID == "" || paymentIntentID == "" || input.PromotionID == "" || input.PromotionVersion < 1 || input.DiscountMinor <= 0 {
		return ErrPromotionFundingInvalidInput
	}
	switch input.FundingSource {
	case "PARTNER", "BTHWANI":
		if input.PartnerSharePercent != nil {
			return ErrPromotionFundingInvalidInput
		}
	case "SHARED":
		if input.PartnerSharePercent == nil || *input.PartnerSharePercent < 1 || *input.PartnerSharePercent > 99 {
			return ErrPromotionFundingInvalidInput
		}
	default:
		return ErrPromotionFundingInvalidInput
	}
	var partnerFunded, bthwaniFunded int64
	switch input.FundingSource {
	case "PARTNER":
		partnerFunded = input.DiscountMinor
	case "BTHWANI":
		bthwaniFunded = input.DiscountMinor
	case "SHARED":
		// Integer floor split, server-owned and deterministic; the platform
		// absorbs the fractional remainder up to the full discount.
		partnerFunded = input.DiscountMinor * int64(*input.PartnerSharePercent) / 100
		bthwaniFunded = input.DiscountMinor - partnerFunded
	}
	id, err := newID("promo-funding")
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.order_promotion_funding(id,order_id,payment_intent_id,promotion_id,promotion_version,promotion_code,store_id,discount_minor,funding_source,partner_share_percent,partner_funded_minor,bthwani_funded_minor,currency,kind)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'YER','ORDER')`, id, orderID, paymentIntentID, input.PromotionID, input.PromotionVersion, input.PromotionCode, input.StoreID, input.DiscountMinor, input.FundingSource, input.PartnerSharePercent, partnerFunded, bthwaniFunded); err != nil {
		return fmt.Errorf("freeze order promotion funding: %w", err)
	}
	return nil
}

// readOrderPromotionFunding returns the frozen funding truth for an order; the
// second return is false when the order has no promotion funding row (legacy or
// unfunded orders).
func readOrderPromotionFunding(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, orderID string) (OrderPromotionFundingRecord, bool, error) {
	var record OrderPromotionFundingRecord
	var storeID sql.NullString
	var share sql.NullInt64
	err := source.QueryRowContext(ctx, `SELECT id,order_id,payment_intent_id,promotion_id,promotion_version,promotion_code,COALESCE(store_id,''),discount_minor,funding_source,partner_share_percent,partner_funded_minor,bthwani_funded_minor,currency,kind
		FROM wlt.order_promotion_funding WHERE order_id=$1 AND kind='ORDER'`, strings.TrimSpace(orderID)).Scan(
		&record.ID, &record.OrderID, &record.PaymentIntentID, &record.PromotionID, &record.PromotionVersion, &record.PromotionCode, &storeID,
		&record.DiscountMinor, &record.FundingSource, &share, &record.PartnerFundedMinor, &record.BthwaniFundedMinor, &record.Currency, &record.Kind)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderPromotionFundingRecord{}, false, nil
	}
	if err != nil {
		return OrderPromotionFundingRecord{}, false, err
	}
	if storeID.Valid {
		record.StoreID = storeID.String
	}
	if share.Valid {
		value := int(share.Int64)
		record.PartnerSharePct = &value
	}
	return record, true, nil
}

// partnerChargedDiscount resolves how much of the order discount the Partner
// absorbs economically. Legacy orders without a funding row keep the prior
// behavior: the Partner absorbs the whole discount.
func partnerChargedDiscount(funding *OrderPromotionFundingRecord, discountMinor int64) int64 {
	if funding == nil {
		return discountMinor
	}
	return funding.PartnerFundedMinor
}
