package transporthttp

import (
	"testing"
	"time"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func TestProjectCustomerWithdrawalIntakeKeepsServiceContractsDistinct(t *testing.T) {
	requestedAt := time.Date(2026, time.September, 27, 12, 30, 0, 0, time.UTC)
	resolvedAt := requestedAt.Add(time.Hour)
	destinationID := "destination-1"
	payoutID := "payout-1"
	payoutStatus := "HELD"
	payoutCurrency := "YER"
	financeActorID := "finance-1"
	resolutionReason := "approved for review"
	payoutAmount := int64(1250)

	got := projectCustomerWithdrawalIntake(wltintegration.CustomerWithdrawalIntake{
		ID: "intake-1", CustomerActorID: "customer-1", ProviderKey: "cash-wallet",
		WalletIdentifierMasked: "••••1234", BeneficiaryName: "Customer Name",
		BeneficiaryIdentityVersion: 4, RequestReason: "manual withdrawal",
		RequestEvidenceDocumentID: "evidence-1", Status: "PAYOUT_HELD",
		DestinationID: &destinationID, PayoutID: &payoutID, PayoutStatus: &payoutStatus,
		PayoutAmountMinor: &payoutAmount, PayoutCurrency: &payoutCurrency,
		RequestedBy: "operator-1", RequestedAt: requestedAt, FinanceActorID: &financeActorID,
		ResolvedAt: &resolvedAt, ResolutionReason: &resolutionReason,
	}, wltintegration.PayoutState{
		Currency: "YER", EligibleAvailableMinor: 2400, HeldMinor: 600,
	})

	if got.ID != "intake-1" || got.DestinationID != destinationID || got.PayoutID != payoutID {
		t.Fatalf("intake identifiers were not projected: %+v", got)
	}
	if got.PayoutAmountMinor != int(payoutAmount) || got.PayoutCurrency != payoutCurrency || got.PayoutStatus != payoutStatus {
		t.Fatalf("payout facts were not projected: %+v", got)
	}
	if got.RequestedAt != requestedAt || got.ResolvedAt == nil || *got.ResolvedAt != resolvedAt {
		t.Fatalf("intake timestamps were not preserved: %+v", got)
	}
	if got.Currency != "YER" || got.EligibleAvailableMinor != 2400 || got.HeldMinor != 600 {
		t.Fatalf("WLT payout readback was not projected into the DSH contract: %+v", got)
	}
}

func TestProjectCustomerWithdrawalSummaryPreservesCanonicalReadback(t *testing.T) {
	requestedAt := time.Date(2026, time.September, 27, 13, 30, 0, 0, time.UTC)
	destinationID := "destination-1"
	destinationStatus := "ACTIVE_FOR_PAYOUT"
	verificationStatus := "VERIFIED"
	payoutID := "payout-1"
	payoutStatus := "COMPLETED"
	payoutCurrency := "YER"
	payoutAmount := int64(1250)

	got := projectCustomerWithdrawalIntakeSummary(wltintegration.CustomerWithdrawalIntakeSummary{
		ID: "intake-1", CustomerActorID: "customer-1", ProviderKey: "cash-wallet",
		WalletIdentifierMasked: "••••1234", BeneficiaryName: "Customer Name", Status: "COMPLETED",
		DestinationID: &destinationID, DestinationStatus: &destinationStatus,
		DestinationVerificationStatus: &verificationStatus, PayoutID: &payoutID,
		PayoutStatus: &payoutStatus, PayoutAmountMinor: &payoutAmount,
		PayoutCurrency: &payoutCurrency, RequestedAt: requestedAt,
	})

	if got.ID != "intake-1" || got.DestinationID != destinationID || got.DestinationStatus != destinationStatus {
		t.Fatalf("destination readback was not projected: %+v", got)
	}
	if got.PayoutID != payoutID || got.PayoutStatus != payoutStatus || got.PayoutAmountMinor != int(payoutAmount) || got.PayoutCurrency != payoutCurrency {
		t.Fatalf("payout readback was not projected: %+v", got)
	}
	if got.RequestedAt != requestedAt {
		t.Fatalf("requestedAt = %s, want %s", got.RequestedAt, requestedAt)
	}
}
