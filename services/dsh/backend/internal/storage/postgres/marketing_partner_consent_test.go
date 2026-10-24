package postgres

import (
	"errors"
	"testing"
	"time"
)

func TestPlatformPartnerFundedPromotionRequiresExplicitStoreConsent(t *testing.T) {
	share := 50
	budget := int64(50000)
	base := PromotionInput{
		ID: "promotion-test", Code: "CONSENT10", NameAr: "عرض تجريبي",
		Kind: "PERCENTAGE", ValueMinor: 10,
		FundingSource: "BTHWANI", StartsAt: time.Now().UTC(), DiscountBudgetLimitMinor: &budget,
	}
	tests := []struct {
		name     string
		source   string
		storeID  string
		optIn    bool
		share    *int
		rejected bool
	}{
		{"platform-only funding requires no consent", "BTHWANI", "", false, nil, false},
		{"global partner funding without consent", "PARTNER", "", false, nil, true},
		{"global partner funding with consent", "PARTNER", "", true, nil, false},
		{"shared funding without consent", "SHARED", "", false, &share, true},
		{"shared funding with consent", "SHARED", "", true, &share, false},
		{"partner-owned scoped store offer", "PARTNER", "store-owned", false, nil, false},
		{"store-scoped campaign cannot opt in to platform participation", "PARTNER", "store-owned", true, nil, true},
	}
	// A published platform-funded Partner liability must never be unbounded.
	for _, funding := range []string{"BTHWANI", "PARTNER", "SHARED"} {
		input := base
		input.FundingSource = funding
		input.RequiresPartnerOptIn = true
		input.DiscountBudgetLimitMinor = nil
		if funding == "SHARED" {
			input.FundingSharePartnerPercent = &share
		}
		if err := validatePromotionInput(input); !errors.Is(err, ErrPromotionInvalid) {
			t.Fatalf("uncapped %s funding must be rejected: %v", funding, err)
		}
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			input := base
			input.FundingSource = tc.source
			input.StoreID = tc.storeID
			input.RequiresPartnerOptIn = tc.optIn
			input.FundingSharePartnerPercent = tc.share
			err := validatePromotionInput(input)
			if tc.rejected && !errors.Is(err, ErrPromotionInvalid) {
				t.Fatalf("want invalid promotion, got %v", err)
			}
			if !tc.rejected && err != nil {
				t.Fatalf("expected valid promotion, got %v", err)
			}
		})
	}
}
