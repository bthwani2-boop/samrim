package postgres

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

func TestStoreCommercialAgreementLifecycleAndOrderSnapshots(t *testing.T) {
	scenario := newFieldAcquisitionScenario(t)
	suffix := scenario.suffix
	storeID := "agreement-store-" + suffix
	partnerID := "agreement-partner-" + suffix
	fieldID := "agreement-field-" + suffix
	financeID := "agreement-finance-" + suffix
	customerID := "agreement-customer-" + suffix
	typeID := "agreement-type-" + suffix

	defaultSuggestion, replayed, err := UpdateStoreTypeCommissionDefault(scenario.ctx, scenario.db, StoreTypeCommissionDefaultUpdate{
		CommercialStoreTypeID: typeID, FulfillmentMode: "PARTNER_CAPTAIN", CommissionRateBps: 900,
		ChangedByActorID: fieldID, Reason: "initial default suggestion", IdempotencyKey: "default-key-" + suffix, CorrelationID: "default-correlation-" + suffix,
	})
	if err != nil || replayed || defaultSuggestion.CommissionRateBps != 900 {
		t.Fatalf("create Store Type suggestion = %+v replayed=%t err=%v", defaultSuggestion, replayed, err)
	}

	profile, replayed, err := PreparePartnerFinancialProfile(scenario.ctx, scenario.db, PreparePartnerFinancialProfileInput{
		JoiningCaseID: "profile-case-" + suffix, PartnerActorID: partnerID, Origin: domain.OriginControlPanel,
		SettlementPeriod: domain.SettlementWeekly, TermsPolicyVersion: "", IdempotencyKey: "profile-key-" + suffix, CorrelationID: "profile-correlation-" + suffix,
	})
	if err != nil || replayed {
		t.Fatalf("prepare partner financial profile = %+v replayed=%t err=%v", profile, replayed, err)
	}
	profile, replayed, err = ActivatePartnerFinancialProfile(scenario.ctx, scenario.db, ActivatePartnerFinancialProfileInput{
		ProfileID: profile.ID, ExpectedVersion: profile.Version, ActorID: financeID,
		IdempotencyKey: "profile-activate-" + suffix, CorrelationID: "profile-activate-correlation-" + suffix,
	})
	if err != nil || replayed || profile.State != domain.ProfileActive {
		t.Fatalf("activate partner financial profile = %+v replayed=%t err=%v", profile, replayed, err)
	}

	propose := func(version, rate int, key string) StoreCommercialAgreementRecord {
		item, replayed, err := ProposeStoreCommercialAgreement(scenario.ctx, scenario.db, ProposeStoreCommercialAgreementInput{
			StoreID: storeID, PartnerActorID: partnerID,
			Rates:                  []StoreCommercialAgreementRate{{FulfillmentMode: "PARTNER_CAPTAIN", CommissionRateBps: rate}},
			ExpectedCurrentVersion: version, ActorID: fieldID, Reason: "approved Store commission terms",
			IdempotencyKey: key + "-" + suffix, CorrelationID: key + "-correlation-" + suffix,
		})
		if err != nil || replayed || item.AgreementVersion != version+1 || item.Status != "PROPOSED" {
			t.Fatalf("propose Store agreement expected=%d rate=%d = %+v replayed=%t err=%v", version, rate, item, replayed, err)
		}
		return item
	}
	accept := func(item StoreCommercialAgreementRecord, partnerActorID, key string) StoreCommercialAgreementRecord {
		accepted, replayed, err := AcceptStoreCommercialAgreement(scenario.ctx, scenario.db, item.AgreementID, item.AgreementVersion, partnerActorID, "I accept these Store terms", key+"-"+suffix, key+"-correlation-"+suffix)
		if err != nil || replayed || accepted.Status != "PARTNER_ACCEPTED" || accepted.PartnerAcceptedByActorID == nil || *accepted.PartnerAcceptedByActorID != partnerID {
			t.Fatalf("accept Store agreement = %+v replayed=%t err=%v", accepted, replayed, err)
		}
		return accepted
	}
	decide := func(item StoreCommercialAgreementRecord, decision, key string) StoreCommercialAgreementRecord {
		decided, replayed, err := DecideStoreCommercialAgreement(scenario.ctx, scenario.db, StoreCommercialAgreementDecisionInput{
			AgreementID: item.AgreementID, ExpectedVersion: item.AgreementVersion, Decision: decision, ActorID: financeID,
			Reason: "Finance reviewed Store terms", IdempotencyKey: key + "-" + suffix, CorrelationID: key + "-correlation-" + suffix,
		})
		if err != nil || replayed {
			t.Fatalf("Finance %s Store agreement = %+v replayed=%t err=%v", decision, decided, replayed, err)
		}
		return decided
	}

	first := propose(0, 1500, "agreement-v1")
	if _, _, err := AcceptStoreCommercialAgreement(scenario.ctx, scenario.db, first.AgreementID, first.AgreementVersion, "different-partner", "I accept these Store terms", "wrong-owner-"+suffix, "wrong-owner-correlation-"+suffix); !errors.Is(err, ErrStoreCommercialAgreementState) {
		t.Fatalf("wrong Partner acceptance error = %v, want state conflict", err)
	}
	first = accept(first, partnerID, "agreement-v1-accept")
	first = decide(first, "APPROVE", "agreement-v1-finance")
	if first.Status != "ACTIVE" || first.FinanceApprovedByActorID == nil || *first.FinanceApprovedByActorID != financeID ||
		first.FinanceDecisionByActorID == nil || *first.FinanceDecisionByActorID != financeID || first.FinanceDecisionAt == nil ||
		first.FinanceDecisionReason == nil || *first.FinanceDecisionReason != "Finance reviewed Store terms" {
		t.Fatalf("v1 agreement is not active and Finance-approved: %+v", first)
	}
	if _, _, err := DecideStoreCommercialAgreement(scenario.ctx, scenario.db, StoreCommercialAgreementDecisionInput{
		AgreementID: first.AgreementID, ExpectedVersion: first.AgreementVersion, Decision: "APPROVE", ActorID: fieldID,
		Reason: "Finance reviewed Store terms", IdempotencyKey: "wrong-finance-" + suffix, CorrelationID: "wrong-finance-correlation-" + suffix,
	}); !errors.Is(err, ErrStoreCommercialAgreementState) {
		t.Fatalf("proposer Finance decision error = %v, want separation state conflict", err)
	}

	allocation := func(orderID, externalReference, idem string) PaymentIntentRecord {
		input := CustomerPaymentAllocationInput{
			OrderID: orderID, StoreID: storeID, PartnerActorID: partnerID, CommercialStoreTypeID: typeID,
			FulfillmentMode: "PARTNER_CAPTAIN", Currency: "YER", SubtotalMinor: 10000, DiscountMinor: 1000,
			InternalBalanceAmountMinor: 0, CashAmountMinor: 9000, CustomerPayableMinor: 9000,
			PolicyVersion: "store-type-default-is-suggestion-only",
		}
		created, _, err := CreatePaymentIntent(scenario.ctx, scenario.db, CreatePaymentIntentInput{
			ExternalReference: externalReference, PayerActorID: customerID, OrderID: orderID, AmountMinor: 9000,
			Currency: "YER", Method: domain.MethodCashAtStore, CustomerPaymentAllocation: &input,
			IdempotencyKey: idem + "-" + suffix, CorrelationID: idem + "-correlation-" + suffix,
		})
		if err != nil || created.CustomerPaymentAllocation == nil {
			t.Fatalf("create allocated payment intent %s = %+v err=%v", orderID, created, err)
		}
		return created
	}
	oldOrder := allocation("agreement-order-old-"+suffix, "agreement-reference-old-"+suffix, "agreement-payment-old")
	if snapshot := oldOrder.CustomerPaymentAllocation.CommissionSnapshot; snapshot == nil || snapshot.Source != "STORE_AGREEMENT" || snapshot.AgreementID != first.AgreementID || snapshot.AgreementVersion != 1 || snapshot.RateBps != 1500 || snapshot.CalculationBasis != "SUBTOTAL_MINUS_DISCOUNT" || oldOrder.CustomerPaymentAllocation.CommissionSnapshot.PolicyVersion != 0 {
		t.Fatalf("first order commission snapshot = %+v, want Store agreement v1 at 1500 bps, not Store Type suggestion 900", snapshot)
	}

	second := propose(1, 2200, "agreement-v2")
	second = accept(second, partnerID, "agreement-v2-accept")
	if _, _, err := ProposeStoreCommercialAgreement(scenario.ctx, scenario.db, ProposeStoreCommercialAgreementInput{
		StoreID: storeID, PartnerActorID: partnerID, Rates: []StoreCommercialAgreementRate{{FulfillmentMode: "PARTNER_CAPTAIN", CommissionRateBps: 2300}},
		ExpectedCurrentVersion: 1, ActorID: fieldID, Reason: "another Store proposal while pending",
		IdempotencyKey: "agreement-pending-" + suffix, CorrelationID: "agreement-pending-correlation-" + suffix,
	}); !errors.Is(err, ErrStoreCommercialAgreementState) {
		t.Fatalf("proposal while v2 awaits Finance error = %v, want state conflict", err)
	}
	second = decide(second, "APPROVE", "agreement-v2-finance")
	if second.Status != "ACTIVE" {
		t.Fatalf("v2 agreement status = %s, want ACTIVE", second.Status)
	}
	history, err := ReadStoreCommercialAgreements(scenario.ctx, scenario.db, storeID)
	if err != nil || len(history) != 2 || history[0].Status != "SUPERSEDED" || history[1].Status != "ACTIVE" {
		t.Fatalf("Store agreement history = %+v err=%v, want superseded v1 and active v2", history, err)
	}
	newOrder := allocation("agreement-order-new-"+suffix, "agreement-reference-new-"+suffix, "agreement-payment-new")
	if snapshot := newOrder.CustomerPaymentAllocation.CommissionSnapshot; snapshot == nil || snapshot.AgreementID != second.AgreementID || snapshot.AgreementVersion != 2 || snapshot.RateBps != 2200 {
		t.Fatalf("second order commission snapshot = %+v, want agreement v2 at 2200 bps", snapshot)
	}
	oldReadback, err := readCustomerPaymentAllocation(scenario.ctx, scenario.db, oldOrder.ID)
	if err != nil || oldReadback.CommissionSnapshot == nil || oldReadback.CommissionSnapshot.AgreementVersion != 1 || oldReadback.CommissionSnapshot.RateBps != 1500 {
		t.Fatalf("historic order snapshot changed after v2 activation: %+v err=%v", oldReadback, err)
	}

	third := propose(2, 2600, "agreement-v3")
	third = accept(third, partnerID, "agreement-v3-accept")
	third = decide(third, "REJECT", "agreement-v3-finance")
	if third.Status != "FINANCE_REJECTED" || third.FinanceDecisionByActorID == nil || *third.FinanceDecisionByActorID != financeID ||
		third.FinanceDecisionAt == nil || third.FinanceDecisionReason == nil || *third.FinanceDecisionReason != "Finance reviewed Store terms" {
		t.Fatalf("rejected agreement Finance decision readback is incomplete: %+v", third)
	}
	queueProposal := func(storeSuffix string) StoreCommercialAgreementRecord {
		item, replayed, err := ProposeStoreCommercialAgreement(scenario.ctx, scenario.db, ProposeStoreCommercialAgreementInput{
			StoreID: storeID + "-queue-" + storeSuffix, PartnerActorID: partnerID + "-queue-" + storeSuffix,
			Rates:                  []StoreCommercialAgreementRate{{FulfillmentMode: "PARTNER_CAPTAIN", CommissionRateBps: 1700}},
			ExpectedCurrentVersion: 0, ActorID: fieldID, Reason: "Finance queue ordering proposal",
			IdempotencyKey: "agreement-queue-" + storeSuffix + "-" + suffix,
			CorrelationID:  "agreement-queue-correlation-" + storeSuffix + "-" + suffix,
		})
		if err != nil || replayed {
			t.Fatalf("create Finance queue proposal %s = %+v replayed=%t err=%v", storeSuffix, item, replayed, err)
		}
		item, replayed, err = AcceptStoreCommercialAgreement(scenario.ctx, scenario.db, item.AgreementID, item.AgreementVersion,
			item.PartnerActorID, "I accept these Store terms", "agreement-queue-accept-"+storeSuffix+"-"+suffix,
			"agreement-queue-accept-correlation-"+storeSuffix+"-"+suffix)
		if err != nil || replayed || item.Status != "PARTNER_ACCEPTED" {
			t.Fatalf("accept Finance queue proposal %s = %+v replayed=%t err=%v", storeSuffix, item, replayed, err)
		}
		return item
	}
	queueOlder := queueProposal("older")
	queueNewer := queueProposal("newer")
	firstPage, err := ListStoreCommercialAgreementsForFinance(scenario.ctx, scenario.db, "PARTNER_ACCEPTED", nil, "", 1)
	if err != nil || len(firstPage.Agreements) != 1 || firstPage.Agreements[0].AgreementID != queueNewer.AgreementID || firstPage.NextCursor == "" {
		t.Fatalf("first Finance agreement queue page = %+v err=%v, want newest accepted agreement and cursor", firstPage, err)
	}
	cursorParts := strings.SplitN(firstPage.NextCursor, "|", 2)
	if len(cursorParts) != 2 {
		t.Fatalf("Finance queue next cursor = %q, want RFC3339Nano|agreementId", firstPage.NextCursor)
	}
	before, err := time.Parse(time.RFC3339Nano, cursorParts[0])
	if err != nil || cursorParts[1] != queueNewer.AgreementID {
		t.Fatalf("Finance queue next cursor = %q, want timestamp plus newest agreement id", firstPage.NextCursor)
	}
	secondPage, err := ListStoreCommercialAgreementsForFinance(scenario.ctx, scenario.db, "PARTNER_ACCEPTED", &before, cursorParts[1], 1)
	if err != nil || len(secondPage.Agreements) != 1 || secondPage.Agreements[0].AgreementID != queueOlder.AgreementID {
		t.Fatalf("second Finance agreement queue page = %+v err=%v, want next older accepted agreement", secondPage, err)
	}
	var eventCount int
	if err := scenario.db.QueryRowContext(scenario.ctx, "SELECT count(*) FROM wlt.store_commercial_agreement_events WHERE agreement_id IN ($1,$2,$3)", first.AgreementID, second.AgreementID, third.AgreementID).Scan(&eventCount); err != nil {
		t.Fatal(err)
	}
	if eventCount != 10 { // v1 and v2 each have propose/accept/approve; v2 activation supersedes v1; v3 is rejected.
		t.Fatalf("agreement lifecycle event count = %d, want 10", eventCount)
	}
}
