package postgres

import "testing"

func validPaymentAllocation() PaymentAllocationInput {
	return PaymentAllocationInput{
		OrderID:               "order-1",
		Currency:              "YER",
		SubtotalMinor:         4_200,
		CashAmountMinor:       4_200,
		CODProductAmountMinor: 4_200,
		TotalMinor:            4_200,
		PolicyVersion:         "cod-current-v1",
	}
}

func TestValidatePaymentAllocationConservesCODAmount(t *testing.T) {
	if err := validatePaymentAllocation(validPaymentAllocation()); err != nil {
		t.Fatalf("valid COD allocation rejected: %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*PaymentAllocationInput)
	}{
		{name: "component total mismatch", mutate: func(input *PaymentAllocationInput) { input.TotalMinor++ }},
		{name: "payment conservation mismatch", mutate: func(input *PaymentAllocationInput) { input.CashAmountMinor-- }},
		{name: "cod split mismatch", mutate: func(input *PaymentAllocationInput) { input.CODDeliveryAmountMinor = 50 }},
		{name: "negative amount", mutate: func(input *PaymentAllocationInput) { input.DiscountMinor = -1 }},
		{name: "missing order", mutate: func(input *PaymentAllocationInput) { input.OrderID = "" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := validPaymentAllocation()
			test.mutate(&input)
			if err := validatePaymentAllocation(input); err != ErrPaymentAllocationInvalidInput {
				t.Fatalf("expected invalid allocation, got %v", err)
			}
		})
	}
}

func TestValidatePaymentAllocationUsesOverflowSafeConservation(t *testing.T) {
	input := validPaymentAllocation()
	input.TotalMinor = 1
	input.SubtotalMinor = 1
	input.CashAmountMinor = 1
	input.CODProductAmountMinor = 1
	input.PlatformSubsidyMinor = 0
	input.InternalWalletAmountMinor = 0
	input.ExternalOfficialWalletAmountMinor = 0
	input.DeliveryFeeMinor = 0
	input.DiscountMinor = 0

	if err := validatePaymentAllocation(input); err != nil {
		t.Fatalf("small valid allocation rejected: %v", err)
	}

	input.CashAmountMinor = 1<<63 - 1
	input.CODProductAmountMinor = 1<<63 - 1
	input.TotalMinor = 1<<63 - 1
	input.SubtotalMinor = 1<<63 - 1
	input.CODDeliveryAmountMinor = 1
	if err := validatePaymentAllocation(input); err != ErrPaymentAllocationInvalidInput {
		t.Fatalf("overflowing COD split accepted: %v", err)
	}
}
