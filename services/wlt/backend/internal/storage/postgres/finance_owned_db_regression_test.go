package postgres

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// These tests use only the WLT_TEST_DATABASE_URL guarded isolated fixture.
// They never insert data into the shared development runtime.
func TestFundedPromotionPaymentPersistedReplayHasOneFrozenSplit(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	orderID := store + "-funded-order"
	share := 40
	input := CreatePaymentIntentInput{
		ExternalReference: store + "-funded-external",
		PayerActorID:      "proof-customer-" + s.suffix,
		OrderID:           orderID, AmountMinor: 4000, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: orderID, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "finance-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 5000, DiscountMinor: 1000,
			CashAmountMinor: 4000, CustomerPayableMinor: 4000, PolicyVersion: "funded-proof",
			PromotionFunding: &PromotionFundingInput{
				PromotionID: "promotion-" + s.suffix, PromotionVersion: 2, PromotionCode: "SAVE",
				StoreID: store, FundingSource: "SHARED", PartnerSharePercent: &share, DiscountMinor: 1000,
			},
		},
		IdempotencyKey: "funded-key-" + s.suffix, CorrelationID: "funded-correlation-" + s.suffix,
	}
	created, replay, err := CreatePaymentIntent(s.ctx, s.db, input)
	if err != nil || replay {
		t.Fatalf("persist promotion-funded payment: replay=%t err=%v", replay, err)
	}
	var count int
	var partner, platform int64
	checkFunding := func() {
		t.Helper()
		err := s.db.QueryRowContext(s.ctx,
			"SELECT COUNT(*), COALESCE(SUM(partner_funded_minor),0), COALESCE(SUM(bthwani_funded_minor),0) FROM wlt.order_promotion_funding WHERE order_id=$1",
			orderID).Scan(&count, &partner, &platform)
		if err != nil || count != 1 || partner != 400 || platform != 600 {
			t.Fatalf("frozen funding count=%d partner=%d platform=%d err=%v", count, partner, platform, err)
		}
	}
	checkFunding()
	// Recheck both the current persisted fingerprint and the immutable historical format.
	for _, historic := range []bool{false, true} {
		if historic {
			oldHash := hashCreateRequest(input, false)
			if _, err := s.db.ExecContext(s.ctx, "UPDATE wlt.payment_intents SET request_hash=$1 WHERE id=$2", oldHash, created.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := s.db.ExecContext(s.ctx, "UPDATE wlt.payment_intent_events SET request_hash=$1 WHERE intent_id=$2", oldHash, created.ID); err != nil {
				t.Fatal(err)
			}
		}
		var wg sync.WaitGroup
		results := make(chan error, 2)
		for range 2 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				again, repeated, e := CreatePaymentIntent(s.ctx, s.db, input)
				if e == nil && (!repeated || again.ID != created.ID) {
					e = fmt.Errorf("concurrent replay created a new payment: id=%s replay=%t", again.ID, repeated)
				}
				results <- e
			}()
		}
		wg.Wait()
		close(results)
		for e := range results {
			if e != nil {
				t.Fatalf("concurrent funding replay: %v", e)
			}
		}
		changed := input
		alloc := *input.CustomerPaymentAllocation
		funding := *alloc.PromotionFunding
		newShare := 41
		funding.PartnerSharePercent = &newShare
		alloc.PromotionFunding = &funding
		changed.CustomerPaymentAllocation = &alloc
		if _, _, e := CreatePaymentIntent(s.ctx, s.db, changed); !errors.Is(e, ErrIdempotencyConflict) {
			t.Fatalf("same key with different subsidy economics accepted: %v", e)
		}
		checkFunding()
	}
	var intentCount int
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.payment_intents WHERE idempotency_key=$1", input.IdempotencyKey).Scan(&intentCount); err != nil || intentCount != 1 {
		t.Fatalf("payment intent count=%d err=%v", intentCount, err)
	}
}

func TestCaptainCashLiabilityPostgresSummaryBeyondPage(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	captain := "proof-captain-" + s.suffix
	otherCaptain := "proof-other-captain-" + s.suffix
	// Valid, uniquely owned synthetic COD collections. One belongs to a different
	// captain to prove that the running total cannot leak across actors.
	prefix := "cod-liability-proof-" + s.suffix
	_, err := s.db.ExecContext(s.ctx, `
		INSERT INTO wlt.payment_intents
			(id, external_reference, payer_actor_id, amount_minor, currency,
			 method, state, version, idempotency_key, request_hash,
			 collected_amount_minor, collected_by_actor_id, collection_reference, collected_at)
		SELECT $1 || '-' || n, $1 || '-external-' || n, 'customer-' || $1,
		       250, 'YER', 'CASH_ON_DELIVERY', 'COLLECTED', 2,
		       $1 || '-key-' || n, 'synthetic-cod-facts', 250,
		       CASE WHEN n=106 THEN $3 ELSE $2 END,
		       $1 || '-collected-' || n, clock_timestamp()
		FROM generate_series(1,106) n`, prefix, captain, otherCaptain)
	if err != nil {
		t.Fatalf("insert isolated COD proof: %v", err)
	}
	t.Cleanup(func() {
		if _, err := s.db.ExecContext(s.ctx, "DELETE FROM wlt.payment_intents WHERE id LIKE $1", prefix+"-%"); err != nil {
			t.Errorf("cleanup synthetic COD fixture: %v", err)
		}
	})
	for _, limit := range []int{10, 100} {
		actual, err := ListCashLiability(s.ctx, s.db, captain, limit)
		if err != nil || len(actual.Items) != limit || actual.TotalItems != 105 ||
			actual.TotalAmountMinor != 26250 || !actual.HasMore {
			t.Fatalf("limit=%d items=%d totalItems=%d totalMinor=%d hasMore=%t err=%v",
				limit, len(actual.Items), actual.TotalItems, actual.TotalAmountMinor, actual.HasMore, err)
		}
	}
	other, err := ListCashLiability(s.ctx, s.db, otherCaptain, 100)
	if err != nil || len(other.Items) != 1 || other.TotalAmountMinor != 250 || other.HasMore {
		t.Fatalf("cross-captain COD readback=%+v err=%v", other, err)
	}
}

func TestFundedPromotionSettlesIntoConservedPartnerEarnings(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, store, _, _, _, _, _, _ := setupPartnerFinanceProof(t, s, false)
	captain := "finance-captain-" + s.suffix
	tests := []struct {
		source                   string
		share                    *int
		wantPartner, wantBthwani int64
	}{
		{source: "PARTNER", wantPartner: 1000, wantBthwani: 0},
		{source: "BTHWANI", wantPartner: 0, wantBthwani: 1000},
		{source: "SHARED", share: func() *int { v := 40; return &v }(), wantPartner: 400, wantBthwani: 600},
	}
	for _, tt := range tests {
		t.Run(tt.source, func(t *testing.T) {
			orderID := store + "-settled-" + tt.source
			intent, replay, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
				ExternalReference: orderID + "-reference", PayerActorID: "customer-" + s.suffix,
				OrderID: orderID, AmountMinor: 4000, Currency: "YER", Method: domain.MethodCashOnDelivery,
				CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
					OrderID: orderID, StoreID: store, PartnerActorID: owner,
					CommercialStoreTypeID: "finance-type", FulfillmentMode: "BTHWANI_CAPTAIN",
					Currency: "YER", SubtotalMinor: 5000, DiscountMinor: 1000,
					CashAmountMinor: 4000, CustomerPayableMinor: 4000, PolicyVersion: "proof",
					PromotionFunding: &PromotionFundingInput{
						PromotionID: "promotion-" + s.suffix, PromotionVersion: 1,
						PromotionCode: "SAVE", StoreID: store,
						FundingSource: tt.source, PartnerSharePercent: tt.share,
						DiscountMinor: 1000,
					},
				},
				IdempotencyKey: orderID + "-create", CorrelationID: orderID + "-create-correlation",
			})
			if err != nil || replay {
				t.Fatalf("create canonical funded payment: replay=%t err=%v", replay, err)
			}
			_, replay, err = CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{
				IntentID: intent.ID, CollectedAmountMinor: 4000, CollectedByActorID: captain,
				CollectionReference: orderID + "-collection", ExpectedVersion: intent.Version,
				IdempotencyKey: orderID + "-collect", CorrelationID: orderID + "-collect-correlation",
			})
			if err != nil || replay {
				t.Fatalf("collect funded order: replay=%t err=%v", replay, err)
			}
			earningInput := FinalizePartnerOrderEarningInput{
				OrderID: orderID, PaymentIntentID: intent.ID, PartnerActorID: owner,
				CaptainActorID: captain,
				IdempotencyKey: orderID + "-earn", CorrelationID: orderID + "-earn-correlation",
			}
			earning, replay, err := FinalizePartnerOrderEarning(s.ctx, s.db, earningInput)
			if err != nil || replay {
				t.Fatalf("post funded merchant earning: replay=%t err=%v", replay, err)
			}
			if earning.GrossProductMinor != 5000-tt.wantPartner ||
				earning.PartnerNetMinor+earning.CommissionMinor != earning.GrossProductMinor ||
				earning.OrderID != orderID || earning.PaymentIntentID != intent.ID {
				t.Fatalf("wrong funded merchant entitlement: %+v, partner-funded=%d", earning, tt.wantPartner)
			}
			frozen, found, err := readOrderPromotionFunding(s.ctx, s.db, orderID)
			if err != nil || !found || frozen.PartnerFundedMinor != tt.wantPartner ||
				frozen.BthwaniFundedMinor != tt.wantBthwani || frozen.PaymentIntentID != intent.ID {
				t.Fatalf("immutable promotion funding mismatch: %+v found=%t err=%v", frozen, found, err)
			}
			var debits, credits, platformExpense, receivable, partnerCredit int64
			var lines int
			err = s.db.QueryRowContext(s.ctx, `SELECT COUNT(*),
				COALESCE(SUM(amount_minor) FILTER (WHERE direction='DEBIT'),0),
				COALESCE(SUM(amount_minor) FILTER (WHERE direction='CREDIT'),0),
				COALESCE(SUM(amount_minor) FILTER (WHERE account_code='BTHWANI_PROMOTION_EXPENSE' AND direction='DEBIT'),0),
				COALESCE(SUM(amount_minor) FILTER (WHERE account_code='CAPTAIN_CASH_RECEIVABLE' AND direction='DEBIT'),0),
				COALESCE(SUM(amount_minor) FILTER (WHERE account_code='PARTNER_WALLET' AND direction='CREDIT'),0)
				FROM wlt.ledger_entries WHERE transaction_id=$1`, earning.LedgerTransactionID).
				Scan(&lines, &debits, &credits, &platformExpense, &receivable, &partnerCredit)
			if err != nil || lines < 3 || debits != credits || debits != 4000+tt.wantBthwani ||
				platformExpense != tt.wantBthwani || receivable != 4000 ||
				partnerCredit != earning.PartnerNetMinor-earning.CommissionReceivableOffsetMinor {
				t.Fatalf("incorrect funded settlement: lines=%d debit=%d credit=%d platform=%d receivable=%d partner=%d earning=%+v err=%v",
					lines, debits, credits, platformExpense, receivable, partnerCredit, earning, err)
			}
			repeated, isReplay, err := FinalizePartnerOrderEarning(s.ctx, s.db, earningInput)
			if err != nil || !isReplay || repeated.LedgerTransactionID != earning.LedgerTransactionID {
				t.Fatalf("duplicate earning posting: %+v replay=%t err=%v", repeated, isReplay, err)
			}
			var ledgerCount int
			if err := s.db.QueryRowContext(s.ctx,
				"SELECT COUNT(*) FROM wlt.ledger_transactions WHERE source_type='ORDER_DELIVERED' AND source_id=$1",
				orderID).Scan(&ledgerCount); err != nil || ledgerCount != 1 {
				t.Fatalf("duplicate ledger transaction count=%d err=%v", ledgerCount, err)
			}
		})
	}
}
