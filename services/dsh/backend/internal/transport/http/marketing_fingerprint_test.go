package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"testing"
	"time"
)

func TestOperatorPromotionFingerprintProtectsAllFinancialTerms(t *testing.T) {
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	base := contract.CreatePromotionRequest{
		ID: "promotion-one", Code: "SAVE", NameAr: "عرض", Kind: "PERCENTAGE",
		ValueMinor: 10, FundingSource: "SHARED", FundingSharePartnerPercent: 40,
		StartsAt: start, DiscountBudgetLimitMinor: 1000, MaxDiscountMinor: 100,
		MinOrderSubtotalMinor: 300, RedemptionLimit: 10, RequiresPartnerOptIn: true,
		Targets: []contract.PromotionTarget{{TargetKind: "CATEGORY", TargetRef: "cat-a"}},
	}
	expected, err := operatorPromotionCreateHash(base, "operator-a")
	if err != nil {
		t.Fatal(err)
	}
	same, err := operatorPromotionCreateHash(base, "operator-a")
	if err != nil || same != expected {
		t.Fatalf("identical business request must yield stable fingerprint: %v", err)
	}
	differentActor, err := operatorPromotionCreateHash(base, "operator-b")
	if err != nil || differentActor == expected {
		t.Fatalf("actor authority must affect fingerprint: %v", err)
	}
	cases := []struct {
		name   string
		change func(*contract.CreatePromotionRequest)
	}{
		{"partner share", func(x *contract.CreatePromotionRequest) { x.FundingSharePartnerPercent = 60 }},
		{"funding source", func(x *contract.CreatePromotionRequest) { x.FundingSource = "PARTNER" }},
		{"opt in", func(x *contract.CreatePromotionRequest) { x.RequiresPartnerOptIn = false }},
		{"maximum discount", func(x *contract.CreatePromotionRequest) { x.MaxDiscountMinor = 200 }},
		{"minimum order", func(x *contract.CreatePromotionRequest) { x.MinOrderSubtotalMinor = 400 }},
		{"budget limit", func(x *contract.CreatePromotionRequest) { x.DiscountBudgetLimitMinor = 2000 }},
		{"use limit", func(x *contract.CreatePromotionRequest) { x.RedemptionLimit = 5 }},
		{"target", func(x *contract.CreatePromotionRequest) {
			x.Targets = []contract.PromotionTarget{{TargetKind: "CATEGORY", TargetRef: "cat-b"}}
		}},
		{"start", func(x *contract.CreatePromotionRequest) { x.StartsAt = start.Add(time.Hour) }},
		{"rate", func(x *contract.CreatePromotionRequest) { x.ValueMinor = 15 }},
		{"store", func(x *contract.CreatePromotionRequest) { x.StoreID = "store-1" }},
		{"city", func(x *contract.CreatePromotionRequest) { x.ServiceCityID = "city-1" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			variant := base
			tc.change(&variant)
			hash, err := operatorPromotionCreateHash(variant, "operator-a")
			if err != nil || hash == expected {
				t.Fatalf("%s changed but idempotency identity did not: %v", tc.name, err)
			}
		})
	}
}
