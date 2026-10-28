package postgres

import (
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// The first-Store self-service zero-commission agreement must remain
// explicitly accepted and Finance-approved for all admitted delivery modes.
func TestSelfServiceZeroCommissionAgreementAllFulfillmentModes(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	suffix := s.suffix
	partner := "zero-partner-" + suffix
	finance := "zero-finance-" + suffix
	proposer := "zero-proposer-" + suffix
	store := "zero-store-" + suffix
	profile, replayed, err := PreparePartnerFinancialProfile(s.ctx, s.db, PreparePartnerFinancialProfileInput{
		JoiningCaseID: "zero-case-" + suffix, PartnerActorID: partner, Origin: domain.OriginSelfService,
		SettlementPeriod: domain.SettlementWeekly, TermsPolicyVersion: "",
		IdempotencyKey: "zero-profile-" + suffix, CorrelationID: "zero-profile-correlation-" + suffix,
	})
	if err != nil || replayed {
		t.Fatalf("prepare self-service financial profile: %+v replayed=%v err=%v", profile, replayed, err)
	}
	profile, replayed, err = ActivatePartnerFinancialProfile(s.ctx, s.db, ActivatePartnerFinancialProfileInput{
		ProfileID: profile.ID, ExpectedVersion: profile.Version, ActorID: finance,
		IdempotencyKey: "zero-profile-active-" + suffix, CorrelationID: "zero-profile-active-corr-" + suffix,
	})
	if err != nil || replayed || profile.State != domain.ProfileActive {
		t.Fatalf("activate profile: %+v replayed=%v err=%v", profile, replayed, err)
	}
	modes := []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"}
	rates := make([]StoreCommercialAgreementRate, 0, len(modes))
	for _, mode := range modes {
		rates = append(rates, StoreCommercialAgreementRate{FulfillmentMode: mode, CommissionRateBps: 0})
	}
	proposed, replayed, err := ProposeStoreCommercialAgreement(s.ctx, s.db, ProposeStoreCommercialAgreementInput{
		StoreID: store, PartnerActorID: partner, Rates: rates, ExpectedCurrentVersion: 0,
		ActorID: proposer, Reason: "Initial free-product-commission terms",
		IdempotencyKey: "zero-proposal-" + suffix, CorrelationID: "zero-proposal-correlation-" + suffix,
	})
	if err != nil || replayed || proposed.Status != "PROPOSED" || len(proposed.Rates) != 3 {
		t.Fatalf("propose three zero rates: %+v replayed=%v err=%v", proposed, replayed, err)
	}
	_, _, err = AcceptStoreCommercialAgreement(s.ctx, s.db, proposed.AgreementID, proposed.AgreementVersion, "wrong-owner", "I accept the stated zero rates", "zero-wrong-owner-"+suffix, "zero-wrong-owner-corr-"+suffix)
	if !errors.Is(err, ErrStoreCommercialAgreementState) {
		t.Fatalf("wrong owner should be rejected: %v", err)
	}
	accepted, replayed, err := AcceptStoreCommercialAgreement(s.ctx, s.db, proposed.AgreementID, proposed.AgreementVersion, partner, "I accept the stated zero rates", "zero-accept-"+suffix, "zero-accept-corr-"+suffix)
	if err != nil || replayed || accepted.Status != "PARTNER_ACCEPTED" {
		t.Fatalf("partner accept: %+v replayed=%v err=%v", accepted, replayed, err)
	}
	approved, replayed, err := DecideStoreCommercialAgreement(s.ctx, s.db, StoreCommercialAgreementDecisionInput{
		AgreementID: accepted.AgreementID, ExpectedVersion: accepted.AgreementVersion, Decision: "APPROVE", ActorID: finance,
		CurrentStorePartnerActorID: partner, CurrentFulfillmentModes: modes,
		Reason:         "Independent Finance approval of zero rates",
		IdempotencyKey: "zero-finance-approve-" + suffix, CorrelationID: "zero-finance-corr-" + suffix,
	})
	if err != nil || replayed || approved.Status != "ACTIVE" || approved.FinanceApprovedByActorID == nil || *approved.FinanceApprovedByActorID != finance {
		t.Fatalf("Finance approve: %+v replayed=%v err=%v", approved, replayed, err)
	}
	for _, rate := range approved.Rates {
		if rate.CommissionRateBps != 0 {
			t.Fatalf("nonzero commission in an initial free agreement: %+v", rate)
		}
	}
	if len(approved.Rates) != 3 {
		t.Fatalf("not all three modes covered: %+v", approved.Rates)
	}
	history, err := ReadStoreCommercialAgreements(s.ctx, s.db, store)
	if err != nil || len(history) != 1 || history[0].Status != "ACTIVE" {
		t.Fatalf("expected one unchanged active agreement: %+v err=%v", history, err)
	}
}
