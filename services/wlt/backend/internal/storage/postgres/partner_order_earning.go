package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

var (
	ErrPartnerEarningInvalidInput = errors.New("partner order earning input is invalid")
	ErrPartnerEarningNotFound     = errors.New("partner order earning was not found")
	ErrPartnerEarningExists       = errors.New("partner order earning already exists")
	ErrPartnerEarningPaymentState = errors.New("payment is not collected for partner order earning")
	ErrPartnerEarningProfile      = errors.New("active partner financial profile is required")
	ErrLedgerUnbalanced           = errors.New("ledger transaction is unbalanced")
)

type FinalizePartnerOrderEarningInput struct {
	OrderID         string
	PaymentIntentID string
	PartnerActorID  string
	CaptainActorID  string
	IdempotencyKey  string
	CorrelationID   string
}

type PartnerOrderEarningRecord struct {
	OrderID                         string
	PaymentIntentID                 string
	PartnerActorID                  string
	CaptainActorID                  string
	Currency                        string
	GrossProductMinor               int64
	DeliveryFeeMinor                int64
	CommissionMinor                 int64
	PartnerNetMinor                 int64
	CommissionReceivableOffsetMinor int64
	ProfileID                       string
	ProfileVersion                  int
	PolicyVersion                   string
	LedgerTransactionID             string
	CreatedAt                       time.Time
}

type PartnerFinancialSummaryRecord struct {
	PartnerActorID                       string
	Currency                             string
	EarnedMinor                          int64
	CommissionMinor                      int64
	OutstandingCommissionReceivableMinor int64
	OrderCount                           int64
	SettlementPeriod                     string
	ProfileState                         string
	ProfileVersion                       int
	LastEarningAt                        *time.Time
}

func HashFinalizePartnerOrderEarning(input FinalizePartnerOrderEarningInput) string {
	return hashFacts("partner-order-earning-finalize", strings.TrimSpace(input.OrderID), strings.TrimSpace(input.PaymentIntentID), strings.TrimSpace(input.PartnerActorID), strings.TrimSpace(input.CaptainActorID))
}

func FinalizePartnerOrderEarning(ctx context.Context, db *sql.DB, input FinalizePartnerOrderEarningInput) (PartnerOrderEarningRecord, bool, error) {
	input.OrderID = strings.TrimSpace(input.OrderID)
	input.PaymentIntentID = strings.TrimSpace(input.PaymentIntentID)
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	input.CaptainActorID = strings.TrimSpace(input.CaptainActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.OrderID == "" || input.PaymentIntentID == "" || input.PartnerActorID == "" || input.CaptainActorID == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PartnerOrderEarningRecord{}, false, ErrPartnerEarningInvalidInput
	}
	requestHash := HashFinalizePartnerOrderEarning(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-order-earning:"+input.OrderID); err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	var existingHash, existingOrder string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,order_id FROM wlt.partner_order_earnings WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingHash, &existingOrder)
	if err == nil {
		if existingHash != requestHash || existingOrder != input.OrderID {
			return PartnerOrderEarningRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readPartnerOrderEarning(ctx, tx, input.OrderID)
		if readErr != nil {
			return PartnerOrderEarningRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PartnerOrderEarningRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerOrderEarningRecord{}, false, err
	}
	var existingRequestHash string
	err = tx.QueryRowContext(ctx, "SELECT request_hash FROM wlt.partner_order_earnings WHERE order_id=$1 FOR UPDATE", input.OrderID).Scan(&existingRequestHash)
	if err == nil {
		if existingRequestHash == requestHash {
			return PartnerOrderEarningRecord{}, false, ErrPartnerEarningExists
		}
		return PartnerOrderEarningRecord{}, false, ErrIdempotencyConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PartnerOrderEarningRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-commission-balance:"+input.PartnerActorID); err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}

	var paymentState, currency, method string
	var paymentAmount int64
	var allocation CustomerPaymentAllocationRecord
	err = tx.QueryRowContext(ctx, `SELECT p.state,p.amount_minor,p.currency,p.method,a.id,a.order_id,a.payment_intent_id,a.currency,a.subtotal_minor,a.delivery_fee_minor,a.discount_minor,a.internal_balance_amount_minor,a.cash_amount_minor,a.customer_payable_minor,a.policy_version,a.created_at
		FROM wlt.payment_intents p JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=p.id
		WHERE p.id=$1 FOR UPDATE OF p,a`, input.PaymentIntentID).Scan(&paymentState, &paymentAmount, &currency, &method, &allocation.ID, &allocation.OrderID, &allocation.PaymentIntentID, &allocation.Currency, &allocation.SubtotalMinor, &allocation.DeliveryFeeMinor, &allocation.DiscountMinor, &allocation.InternalBalanceAmountMinor, &allocation.CashAmountMinor, &allocation.CustomerPayableMinor, &allocation.PolicyVersion, &allocation.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerOrderEarningRecord{}, false, ErrCustomerPaymentAllocationNotFound
	}
	if err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	if paymentState != domain.StateCollected || method != domain.MethodCashOnDelivery || allocation.OrderID != input.OrderID || currency != allocation.Currency || paymentAmount != allocation.CustomerPayableMinor {
		return PartnerOrderEarningRecord{}, false, ErrPartnerEarningPaymentState
	}

	var profileID, profilePartner, settlementPeriod, profileState string
	var commissionRateBps, profileVersion int
	var roundingUnit int64
	err = tx.QueryRowContext(ctx, `SELECT id,partner_actor_id,commission_rate_bps,settlement_period,rounding_unit_minor,state,version FROM wlt.partner_financial_profiles WHERE partner_actor_id=$1 AND state='ACTIVE' FOR SHARE`, input.PartnerActorID).Scan(&profileID, &profilePartner, &commissionRateBps, &settlementPeriod, &roundingUnit, &profileState, &profileVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerOrderEarningRecord{}, false, ErrPartnerEarningProfile
	}
	if err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	if profilePartner != input.PartnerActorID || profileState != domain.ProfileActive || roundingUnit != 50 {
		return PartnerOrderEarningRecord{}, false, ErrPartnerEarningProfile
	}

	chargeableProduct := allocation.SubtotalMinor - allocation.DiscountMinor
	if chargeableProduct < 0 {
		return PartnerOrderEarningRecord{}, false, ErrPartnerEarningInvalidInput
	}
	commission, err := roundedCommission(chargeableProduct, commissionRateBps, roundingUnit)
	if err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	partnerNet := chargeableProduct - commission
	if partnerNet < 0 {
		return PartnerOrderEarningRecord{}, false, ErrPartnerEarningInvalidInput
	}
	receivableBalance, err := ReadPartnerCommissionReceivableBalance(ctx, tx, input.PartnerActorID)
	if err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	receivableOffset, err := partnerCommissionReceivableOffset(partnerNet, receivableBalance)
	if err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}

	transactionID, err := newID("ledger")
	if err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'PARTNER_ORDER_EARNING_POSTED','ORDER_DELIVERED',$2,$3,$4,$5,$6)`, transactionID, input.OrderID, allocation.Currency, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	entries := []ledgerEntryInput{{"asset", "CAPTAIN_CASH_RECEIVABLE", "DEBIT", allocation.CashAmountMinor}, {"asset", "CUSTOMER_PAYMENT_CLEARING", "DEBIT", allocation.CustomerPayableMinor - allocation.CashAmountMinor}, {"liability", "PARTNER_WALLET", "CREDIT", partnerNet - receivableOffset}, {"asset", "PARTNER_COMMISSION_RECEIVABLE", "CREDIT", receivableOffset}, {"income", "PLATFORM_COMMISSION_INCOME", "CREDIT", commission}, {"liability", "CAPTAIN_WALLET", "CREDIT", allocation.DeliveryFeeMinor}}
	debitTotal, creditTotal := int64(0), int64(0)
	sequence := 1
	for _, entry := range entries {
		if entry.amount == 0 {
			continue
		}
		var actorType, actorID *string
		if entry.accountCode == "PARTNER_WALLET" || entry.accountCode == "PARTNER_COMMISSION_RECEIVABLE" {
			actorType, actorID = stringPtr("partner"), &input.PartnerActorID
		}
		if entry.accountCode == "CAPTAIN_WALLET" {
			actorType, actorID = stringPtr("captain"), &input.CaptainActorID
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, transactionID, sequence, entry.accountClass, entry.accountCode, actorType, actorID, entry.direction, entry.amount, allocation.Currency); err != nil {
			return PartnerOrderEarningRecord{}, false, err
		}
		if entry.direction == "DEBIT" {
			debitTotal += entry.amount
		} else {
			creditTotal += entry.amount
		}
		sequence++
	}
	if debitTotal != creditTotal || debitTotal != allocation.CustomerPayableMinor {
		return PartnerOrderEarningRecord{}, false, ErrLedgerUnbalanced
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.partner_order_earnings(order_id,payment_intent_id,partner_actor_id,captain_actor_id,currency,gross_product_minor,delivery_fee_minor,commission_minor,partner_net_minor,commission_receivable_offset_minor,profile_id,profile_version,policy_version,ledger_transaction_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, input.OrderID, input.PaymentIntentID, input.PartnerActorID, input.CaptainActorID, allocation.Currency, chargeableProduct, allocation.DeliveryFeeMinor, commission, partnerNet, receivableOffset, profileID, profileVersion, fmt.Sprintf("partner-commission-products-v1;profile=%s;settlement=%s", profileID, settlementPeriod), transactionID, input.IdempotencyKey, requestHash); err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerOrderEarningRecord{}, false, err
	}
	item, err := ReadPartnerOrderEarning(ctx, db, input.OrderID)
	return item, false, err
}

type ledgerEntryInput struct {
	accountClass, accountCode, direction string
	amount                               int64
}

func stringPtr(value string) *string { return &value }

func partnerCommissionReceivableOffset(partnerNetMinor, receivableBalanceMinor int64) (int64, error) {
	if partnerNetMinor < 0 || receivableBalanceMinor < 0 {
		return 0, ErrPartnerEarningInvalidInput
	}
	if receivableBalanceMinor < partnerNetMinor {
		return receivableBalanceMinor, nil
	}
	return partnerNetMinor, nil
}

func roundedCommission(base int64, rateBps int, unit int64) (int64, error) {
	if base < 0 || rateBps < 0 || rateBps > 10000 || unit != 50 {
		return 0, ErrPartnerEarningInvalidInput
	}
	product := new(big.Int).Mul(big.NewInt(base), big.NewInt(int64(rateBps)))
	product.Quo(product, big.NewInt(10000))
	if product.Sign() == 0 {
		return 0, nil
	}
	product.Add(product, big.NewInt(unit/2))
	product.Quo(product, big.NewInt(unit))
	product.Mul(product, big.NewInt(unit))
	if !product.IsInt64() || product.Int64() > base {
		return base, nil
	}
	return product.Int64(), nil
}

func ReadPartnerOrderEarning(ctx context.Context, db *sql.DB, orderID string) (PartnerOrderEarningRecord, error) {
	if db == nil || strings.TrimSpace(orderID) == "" {
		return PartnerOrderEarningRecord{}, ErrPartnerEarningInvalidInput
	}
	return readPartnerOrderEarning(ctx, db, strings.TrimSpace(orderID))
}

func readPartnerOrderEarning(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, orderID string) (PartnerOrderEarningRecord, error) {
	var item PartnerOrderEarningRecord
	err := source.QueryRowContext(ctx, `SELECT order_id,payment_intent_id,partner_actor_id,captain_actor_id,currency,gross_product_minor,delivery_fee_minor,commission_minor,partner_net_minor,commission_receivable_offset_minor,profile_id,profile_version,policy_version,ledger_transaction_id,created_at FROM wlt.partner_order_earnings WHERE order_id=$1`, orderID).Scan(&item.OrderID, &item.PaymentIntentID, &item.PartnerActorID, &item.CaptainActorID, &item.Currency, &item.GrossProductMinor, &item.DeliveryFeeMinor, &item.CommissionMinor, &item.PartnerNetMinor, &item.CommissionReceivableOffsetMinor, &item.ProfileID, &item.ProfileVersion, &item.PolicyVersion, &item.LedgerTransactionID, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerOrderEarningRecord{}, ErrPartnerEarningNotFound
	}
	return item, err
}

func ReadPartnerFinancialSummary(ctx context.Context, db *sql.DB, partnerActorID string) (PartnerFinancialSummaryRecord, error) {
	partnerActorID = strings.TrimSpace(partnerActorID)
	if db == nil || partnerActorID == "" {
		return PartnerFinancialSummaryRecord{}, ErrPartnerEarningInvalidInput
	}
	var result PartnerFinancialSummaryRecord
	result.PartnerActorID, result.Currency = partnerActorID, "YER"
	err := db.QueryRowContext(ctx, `SELECT COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='CREDIT'),0),COALESCE((SELECT SUM(commission_minor) FROM wlt.partner_order_earnings WHERE partner_actor_id=$1),0)+COALESCE((SELECT SUM(commission_minor) FROM wlt.partner_store_cash_commissions WHERE partner_actor_id=$1),0),COUNT(DISTINCT t.source_id),MAX(e.created_at) FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id WHERE e.account_code='PARTNER_WALLET' AND e.actor_id=$1`, partnerActorID).Scan(&result.EarnedMinor, &result.CommissionMinor, &result.OrderCount, &result.LastEarningAt)
	if err != nil {
		return PartnerFinancialSummaryRecord{}, err
	}
	result.OutstandingCommissionReceivableMinor, err = ReadPartnerCommissionReceivableBalance(ctx, db, partnerActorID)
	if err != nil {
		return PartnerFinancialSummaryRecord{}, err
	}
	var profileState string
	err = db.QueryRowContext(ctx, `SELECT settlement_period,state,version FROM wlt.partner_financial_profiles WHERE partner_actor_id=$1`, partnerActorID).Scan(&result.SettlementPeriod, &profileState, &result.ProfileVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return PartnerFinancialSummaryRecord{}, ErrFinancialProfileNotFound
	}
	if err != nil {
		return PartnerFinancialSummaryRecord{}, err
	}
	result.ProfileState = profileState
	return result, nil
}
