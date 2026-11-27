package wallet

import (
	"testing"
	"time"
)

func TestAgreementProposalFreezesExactTerms(t *testing.T) {
	points := int32(0)
	proposal := AgreementProposal{
		StoreID: "store-a", OperationID: "proposal-op-01", FeeModel: "COMMISSION",
		Collector: "STORE_MANAGED", CommissionBasisPoints: &points,
		FulfillmentModes:    []string{"CUSTOMER_PICKUP"},
		ProposedEffectiveAt: time.Date(2027, 1, 2, 5, 0, 1, 999000, time.FixedZone("Aden", 3*60*60)),
		Reason:              "first proposed terms",
	}
	frozen, valid := freezeAgreementProposal(proposal)
	if !valid || frozen.ProposedEffectiveAt.Location() != time.UTC ||
		!frozen.ProposedEffectiveAt.Equal(proposal.ProposedEffectiveAt) {
		t.Fatalf("unexpected proposal normalization: %+v %t", frozen, valid)
	}
	points = 42
	proposal.FulfillmentModes[0] = "BTHWANI_CAPTAIN"
	if *frozen.CommissionBasisPoints != 0 || frozen.FulfillmentModes[0] != "CUSTOMER_PICKUP" {
		t.Fatal("caller mutation changed frozen terms")
	}
	amount, period := int64(9007199254740993), int32(30)
	subscription := proposal
	subscription.FeeModel = "SUBSCRIPTION"
	subscription.CommissionBasisPoints = nil
	subscription.SubscriptionAmountYER, subscription.SubscriptionPeriodDays = &amount, &period
	retained, valid := freezeAgreementProposal(subscription)
	amount, period = 1, 1
	if !valid || *retained.SubscriptionAmountYER != 9007199254740993 || *retained.SubscriptionPeriodDays != 30 {
		t.Fatal("subscription money or term was rounded or mutable")
	}
}

func TestAgreementProposalRejectsInconsistentTerms(t *testing.T) {
	points, excess, period := int32(50), int32(10001), int32(30)
	amount := int64(1)
	base := AgreementProposal{
		StoreID: "store-a", OperationID: "proposal-op-01", FeeModel: "COMMISSION",
		Collector: "PLATFORM_MANAGED", CommissionBasisPoints: &points,
		FulfillmentModes:    []string{"CUSTOMER_PICKUP"},
		ProposedEffectiveAt: time.Date(2027, 1, 2, 0, 0, 0, 0, time.UTC),
		Reason:              "first proposed terms",
	}
	for _, tc := range []struct {
		name string
		edit func(*AgreementProposal)
	}{
		{"unsafe next version", func(p *AgreementProposal) { p.ExpectedVersion = 9007199254740991 }},
		{"unknown collector", func(p *AgreementProposal) { p.Collector = "DEFAULT" }},
		{"commission too high", func(p *AgreementProposal) { p.CommissionBasisPoints = &excess }},
		{"missing commission", func(p *AgreementProposal) { p.CommissionBasisPoints = nil }},
		{"mixed fee models", func(p *AgreementProposal) { p.SubscriptionAmountYER = &amount }},
		{"subscription without period", func(p *AgreementProposal) {
			p.FeeModel, p.CommissionBasisPoints, p.SubscriptionAmountYER = "SUBSCRIPTION", nil, &amount
		}},
		{"subscription without amount", func(p *AgreementProposal) {
			p.FeeModel, p.CommissionBasisPoints, p.SubscriptionPeriodDays = "SUBSCRIPTION", nil, &period
		}},
		{"hybrid fees", func(p *AgreementProposal) { p.FeeModel = "HYBRID" }},
		{"missing fulfillment", func(p *AgreementProposal) { p.FulfillmentModes = nil }},
		{"duplicate fulfillment", func(p *AgreementProposal) { p.FulfillmentModes = []string{"CUSTOMER_PICKUP", "CUSTOMER_PICKUP"} }},
		{"unrecognized fulfillment", func(p *AgreementProposal) { p.FulfillmentModes = []string{"DELIVERY"} }},
		{"lossy timestamp", func(p *AgreementProposal) { p.ProposedEffectiveAt = p.ProposedEffectiveAt.Add(time.Nanosecond) }},
		{"zero timestamp", func(p *AgreementProposal) { p.ProposedEffectiveAt = time.Time{} }},
		{"leading whitespace", func(p *AgreementProposal) { p.Reason = " " + p.Reason }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := base
			tc.edit(&input)
			if _, valid := freezeAgreementProposal(input); valid {
				t.Fatal("invalid proposal admitted")
			}
		})
	}
}
