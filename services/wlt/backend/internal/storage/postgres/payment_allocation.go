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
	ErrInsufficientCustomerBalance           = errors.New("customer internal balance is insufficient")
)

type CustomerPaymentAllocationInput struct {
	OrderID, StoreID, PartnerActorID, CommercialStoreTypeID, FulfillmentMode, Currency                                string
	SubtotalMinor, DeliveryFeeMinor, DiscountMinor, InternalBalanceAmountMinor, CashAmountMinor, CustomerPayableMinor int64
	PolicyVersion                                                                                                     string
	// PromotionFunding freezes the exact monetary promotion split on the
	// WLT-owned funding row when the checkout order carried a promotion.
	PromotionFunding *PromotionFundingInput
}

type PartnerStoreCommissionSnapshot struct {
	Source                string
	CommercialStoreTypeID string
	AgreementID           string
	AgreementVersion      int
	FulfillmentMode       string
	CalculationBasis      string
	RateBps               int
	PolicyVersion         int
	ProfileID             string
	ProfileVersion        int
	RoundingUnitMinor     int64
	SettlementPeriod      string
}

type CustomerPaymentAllocationRecord struct {
	ID, OrderID, PaymentIntentID, StoreID, PartnerActorID, CommercialStoreTypeID, FulfillmentMode, Currency           string
	SubtotalMinor, DeliveryFeeMinor, DiscountMinor, InternalBalanceAmountMinor, CashAmountMinor, CustomerPayableMinor int64
	PolicyVersion                                                                                                     string
	CommissionSnapshot                                                                                                *PartnerStoreCommissionSnapshot
	CreatedAt                                                                                                         time.Time
}

func validateCustomerPaymentAllocation(i CustomerPaymentAllocationInput) error {
	if strings.TrimSpace(i.OrderID) == "" || strings.TrimSpace(i.StoreID) == "" || strings.TrimSpace(i.PartnerActorID) == "" ||
		strings.TrimSpace(i.CommercialStoreTypeID) == "" || len(strings.TrimSpace(i.CommercialStoreTypeID)) > 128 ||
		!isStoreTypeCommissionMode(i.FulfillmentMode) || strings.TrimSpace(i.Currency) != "YER" || i.CustomerPayableMinor <= 0 {
		return ErrCustomerPaymentAllocationInvalidInput
	}
	if i.FulfillmentMode != "BTHWANI_CAPTAIN" && i.DeliveryFeeMinor != 0 {
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

func snapshotPartnerStoreAgreementTx(ctx context.Context, tx *sql.Tx, i CustomerPaymentAllocationInput) (PartnerStoreCommissionSnapshot, error) {
	var profileID, settlementPeriod string
	var agreementID string
	var agreementVersion, profileVersion int
	var roundingUnit int64
	var rate int
	var mode string
	err := tx.QueryRowContext(ctx, `SELECT a.agreement_id,a.agreement_version,r.fulfillment_mode,r.commission_rate_bps,f.id,f.version,f.rounding_unit_minor,f.settlement_period
		FROM wlt.store_commercial_agreements a
		JOIN wlt.store_commercial_agreement_rates r ON r.agreement_id=a.agreement_id AND r.fulfillment_mode=$3
		JOIN wlt.partner_financial_profiles f ON f.partner_actor_id=$2 AND f.state='ACTIVE'
		WHERE a.store_id=$1 AND a.partner_actor_id=$2 AND a.status='ACTIVE' FOR SHARE OF a,r,f`, strings.TrimSpace(i.StoreID), strings.TrimSpace(i.PartnerActorID), strings.TrimSpace(i.FulfillmentMode)).Scan(
		&agreementID, &agreementVersion, &mode, &rate, &profileID, &profileVersion, &roundingUnit, &settlementPeriod)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerStoreCommissionSnapshot{}, ErrStoreCommercialAgreementUnavailable
	}
	if err != nil {
		return PartnerStoreCommissionSnapshot{}, err
	}
	if agreementID == "" || agreementVersion < 1 || mode != strings.TrimSpace(i.FulfillmentMode) || rate < 0 || rate > 10000 || profileID == "" || profileVersion < 1 || roundingUnit != 50 || (settlementPeriod != "DAILY" && settlementPeriod != "WEEKLY" && settlementPeriod != "MONTHLY") {
		return PartnerStoreCommissionSnapshot{}, ErrStoreCommercialAgreementUnavailable
	}
	return PartnerStoreCommissionSnapshot{Source: "STORE_AGREEMENT", CommercialStoreTypeID: strings.TrimSpace(i.CommercialStoreTypeID), AgreementID: agreementID, AgreementVersion: agreementVersion, FulfillmentMode: strings.TrimSpace(i.FulfillmentMode), CalculationBasis: "SUBTOTAL_MINUS_DISCOUNT", RateBps: rate, ProfileID: profileID, ProfileVersion: profileVersion, RoundingUnitMinor: roundingUnit, SettlementPeriod: settlementPeriod}, nil
}

func readCustomerPaymentAllocation(ctx context.Context, s interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, pid string) (CustomerPaymentAllocationRecord, error) {
	var a CustomerPaymentAllocationRecord
	err := scanCustomerPaymentAllocation(s.QueryRowContext(ctx, `SELECT id,order_id,payment_intent_id,store_id,partner_actor_id_snapshot,commercial_store_type_id,fulfillment_mode,currency,subtotal_minor,delivery_fee_minor,discount_minor,internal_balance_amount_minor,cash_amount_minor,customer_payable_minor,policy_version,commission_rate_bps_snapshot,commission_policy_version_snapshot,commission_profile_id_snapshot,commission_profile_version_snapshot,commission_rounding_unit_minor_snapshot,commission_settlement_period_snapshot,commission_snapshot_source,commission_agreement_id_snapshot,commission_agreement_version_snapshot,commission_calculation_basis_snapshot,created_at FROM wlt.customer_payment_allocations WHERE payment_intent_id=$1`, pid), &a)
	if errors.Is(err, sql.ErrNoRows) {
		return CustomerPaymentAllocationRecord{}, ErrCustomerPaymentAllocationNotFound
	}
	return a, err
}

func scanCustomerPaymentAllocation(row interface{ Scan(...any) error }, a *CustomerPaymentAllocationRecord) error {
	var storeID, partnerActorID, commercialStoreTypeID, fulfillmentMode sql.NullString
	var rateBps, policyVersion, profileVersion, roundingUnit sql.NullInt64
	var profileID, settlementPeriod sql.NullString
	var source, agreementID, calculationBasis sql.NullString
	var agreementVersion sql.NullInt64
	if err := row.Scan(&a.ID, &a.OrderID, &a.PaymentIntentID, &storeID, &partnerActorID, &commercialStoreTypeID, &fulfillmentMode, &a.Currency, &a.SubtotalMinor, &a.DeliveryFeeMinor, &a.DiscountMinor, &a.InternalBalanceAmountMinor, &a.CashAmountMinor, &a.CustomerPayableMinor, &a.PolicyVersion, &rateBps, &policyVersion, &profileID, &profileVersion, &roundingUnit, &settlementPeriod, &source, &agreementID, &agreementVersion, &calculationBasis, &a.CreatedAt); err != nil {
		return err
	}
	if storeID.Valid {
		a.StoreID = storeID.String
	}
	if partnerActorID.Valid {
		a.PartnerActorID = partnerActorID.String
	}
	if commercialStoreTypeID.Valid {
		a.CommercialStoreTypeID = commercialStoreTypeID.String
	}
	if fulfillmentMode.Valid {
		a.FulfillmentMode = fulfillmentMode.String
	}
	if rateBps.Valid || policyVersion.Valid || profileID.Valid || profileVersion.Valid || roundingUnit.Valid || settlementPeriod.Valid {
		if !storeID.Valid || !partnerActorID.Valid || !fulfillmentMode.Valid || !rateBps.Valid || !policyVersion.Valid || !profileID.Valid || !profileVersion.Valid || !roundingUnit.Valid || !settlementPeriod.Valid {
			return ErrCustomerPaymentAllocationInvalidInput
		}
		if !source.Valid {
			return ErrCustomerPaymentAllocationInvalidInput
		}
		snapshot := &PartnerStoreCommissionSnapshot{Source: source.String, CommercialStoreTypeID: a.CommercialStoreTypeID, RateBps: int(rateBps.Int64), PolicyVersion: int(policyVersion.Int64), ProfileID: profileID.String, ProfileVersion: int(profileVersion.Int64), RoundingUnitMinor: roundingUnit.Int64, SettlementPeriod: settlementPeriod.String}
		if agreementID.Valid {
			snapshot.AgreementID = agreementID.String
		}
		if agreementVersion.Valid {
			snapshot.AgreementVersion = int(agreementVersion.Int64)
		}
		if fulfillmentMode.Valid {
			snapshot.FulfillmentMode = fulfillmentMode.String
		}
		if calculationBasis.Valid {
			snapshot.CalculationBasis = calculationBasis.String
		}
		a.CommissionSnapshot = snapshot
	}
	return nil
}

func insertCustomerPaymentAllocationTx(ctx context.Context, tx *sql.Tx, i CustomerPaymentAllocationInput, pid, key, hash, corr string) (CustomerPaymentAllocationRecord, error) {
	snapshot, err := snapshotPartnerStoreAgreementTx(ctx, tx, i)
	if err != nil {
		return CustomerPaymentAllocationRecord{}, err
	}
	id, err := newID("customer-payment-allocation")
	if err != nil {
		return CustomerPaymentAllocationRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.customer_payment_allocations(id,order_id,payment_intent_id,currency,subtotal_minor,delivery_fee_minor,discount_minor,internal_balance_amount_minor,cash_amount_minor,customer_payable_minor,policy_version,store_id,partner_actor_id_snapshot,commercial_store_type_id,fulfillment_mode,commission_rate_bps_snapshot,commission_policy_version_snapshot,commission_profile_id_snapshot,commission_profile_version_snapshot,commission_rounding_unit_minor_snapshot,commission_settlement_period_snapshot,commission_snapshot_source,commission_agreement_id_snapshot,commission_agreement_version_snapshot,commission_calculation_basis_snapshot)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,$17,$18,$19,$20,'STORE_AGREEMENT',$21,$22,$23)`, id, i.OrderID, pid, i.Currency, i.SubtotalMinor, i.DeliveryFeeMinor, i.DiscountMinor, i.InternalBalanceAmountMinor, i.CashAmountMinor, i.CustomerPayableMinor, i.PolicyVersion, i.StoreID, i.PartnerActorID, i.CommercialStoreTypeID, i.FulfillmentMode, snapshot.RateBps, snapshot.ProfileID, snapshot.ProfileVersion, snapshot.RoundingUnitMinor, snapshot.SettlementPeriod, snapshot.AgreementID, snapshot.AgreementVersion, snapshot.CalculationBasis); err != nil {
		return CustomerPaymentAllocationRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.customer_payment_allocation_events(allocation_id,event_type,order_id,payment_intent_id,request_hash,idempotency_key,correlation_id) VALUES($1,'CUSTOMER_PAYMENT_ALLOCATION_CREATED',$2,$3,$4,$5,$6)`, id, i.OrderID, pid, hash, key, corr); err != nil {
		return CustomerPaymentAllocationRecord{}, err
	}
	if i.PromotionFunding != nil && i.DiscountMinor > 0 {
		if err := freezeOrderPromotionFundingTx(ctx, tx, i.OrderID, pid, *i.PromotionFunding); err != nil {
			return CustomerPaymentAllocationRecord{}, err
		}
	}
	return CustomerPaymentAllocationRecord{ID: id, OrderID: i.OrderID, PaymentIntentID: pid, StoreID: i.StoreID, PartnerActorID: i.PartnerActorID, CommercialStoreTypeID: i.CommercialStoreTypeID, FulfillmentMode: i.FulfillmentMode, Currency: i.Currency, SubtotalMinor: i.SubtotalMinor, DeliveryFeeMinor: i.DeliveryFeeMinor, DiscountMinor: i.DiscountMinor, InternalBalanceAmountMinor: i.InternalBalanceAmountMinor, CashAmountMinor: i.CashAmountMinor, CustomerPayableMinor: i.CustomerPayableMinor, PolicyVersion: i.PolicyVersion, CommissionSnapshot: &snapshot}, nil
}
