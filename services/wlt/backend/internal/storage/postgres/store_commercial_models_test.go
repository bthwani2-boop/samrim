package postgres

import "testing"

func TestNormalizeStoreCommercialModel(t *testing.T) {
	recurringInput := func(model string, commissionBps int) ProposeStoreCommercialAgreementInput {
		return ProposeStoreCommercialAgreementInput{
			CommercialModel:      model,
			RecurringAmountMinor: 1500,
			BillingPeriod:        "MONTHLY",
			BillingTimeZone:      "Asia/Aden",
			InvoiceDueDays:       7,
			GraceDays:            3,
			RenewalPolicy:        "MANUAL",
			TerminationTerms:     "Cancel before renewal",
			AdjustmentTerms:      "Manual Finance adjustments",
			Rates: []StoreCommercialAgreementRate{
				{FulfillmentMode: "CUSTOMER_PICKUP", CommissionRateBps: commissionBps},
			},
		}
	}
	tests := []struct {
		name  string
		input ProposeStoreCommercialAgreementInput
		valid bool
		model string
	}{
		{name: "existing commission semantics", valid: true, model: "COMMISSION"},
		{name: "explicit zero commission not subscription", input: ProposeStoreCommercialAgreementInput{CommercialModel: "COMMISSION"}, valid: true, model: "COMMISSION"},
		{name: "hidden recurring amount denied", input: ProposeStoreCommercialAgreementInput{RecurringAmountMinor: 1500}},
		{name: "subscription without terms denied", input: ProposeStoreCommercialAgreementInput{CommercialModel: "SUBSCRIPTION", RecurringAmountMinor: 1500}},
		{name: "subscription cannot carry commission", input: recurringInput("SUBSCRIPTION", 250)},
		{name: "subscription with zero commission", input: recurringInput("SUBSCRIPTION", 0), valid: true, model: "SUBSCRIPTION"},
		{name: "hybrid with fee and commission", input: recurringInput("HYBRID", 250), valid: true, model: "HYBRID"},
		{name: "hybrid must include commission", input: recurringInput("HYBRID", 0)},
		{name: "unsupported time zone denied", input: func() ProposeStoreCommercialAgreementInput {
			value := recurringInput("SUBSCRIPTION", 0)
			value.BillingTimeZone = "UTC"
			return value
		}()},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			valid := normalizeStoreCommercialModel(&tc.input)
			if valid != tc.valid {
				t.Fatalf("valid=%t, expected=%t", valid, tc.valid)
			}
			if valid && tc.input.CommercialModel != tc.model {
				t.Fatalf("model=%s, expected=%s", tc.input.CommercialModel, tc.model)
			}
		})
	}
}
