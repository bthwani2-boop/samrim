package postgres

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func assertMigrationContains(t *testing.T, fileName string, required []string) {
	t.Helper()
	directory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	data, err := os.ReadFile(filepath.Join(directory, fileName))
	if err != nil {
		t.Fatalf("read migration %s: %v", fileName, err)
	}
	sql := string(data)
	for _, fragment := range required {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("migration %s is missing %q", fileName, fragment)
		}
	}
}

func TestStorePayoutRecipientAssignmentMigrationGovernsReadiness(t *testing.T) {
	assertMigrationContains(t, "042_store_payout_recipient_assignments.sql", []string{
		"state IN ('SELECTED_VERIFIED_STAFF', 'RECIPIENT_REVIEW_REQUIRED')",
		"CREATE UNIQUE INDEX store_payout_recipient_assignments_store_uq",
		"assigned_by_actor_id = partner_actor_id",
		"beneficiary_actor_id <> partner_actor_id",
		"event_type IN ('STAFF_SELECTED', 'REVERTED_TO_OWNER', 'MARKED_REVIEW_REQUIRED', 'REASSIGNED_STAFF')",
		"store payout recipient events are immutable",
		"a.state = 'RECIPIENT_REVIEW_REQUIRED'",
		"a.state = 'SELECTED_VERIFIED_STAFF'",
		"USING ERRCODE = 'WLT01'",
		"USING ERRCODE = 'WLT02'",
	})
}

func TestPartnerEarningsStoreAttributionMigrationCarriesCanonicalStoreFacts(t *testing.T) {
	assertMigrationContains(t, "043_partner_earnings_store_attribution.sql", []string{
		"ADD COLUMN store_id text NOT NULL DEFAULT ''",
		"FROM wlt.customer_payment_allocations a",
		"a.order_id = e.order_id AND a.store_id IS NOT NULL",
		"CREATE INDEX partner_order_earnings_partner_store_idx",
	})
}

func TestStorePayoutRecipientInputValidationFailsClosed(t *testing.T) {
	validFacts := IdentityFacts{ActorType: "partner", ActorID: "partner_beneficiary", PhoneE164: "+967771000001", ActorVersion: 1, RoleVersion: 1, RoleEnabled: true, SecurityEnabled: true, OfficialName: "مستلم موثّق", OfficialNameVersion: 1, OfficialNameStatus: "VERIFIED"}
	base := SelectStorePayoutRecipientInput{StoreID: "store-1", PartnerActorID: "partner-owner", BeneficiaryActorID: "partner_beneficiary", BeneficiaryFacts: validFacts, Reason: "اختيار مستلم", IdempotencyKey: "idempotency-key-1", CorrelationID: "correlation-id-1"}
	if _, _, err := SelectStorePayoutRecipient(t.Context(), nil, nil, base); err != ErrStorePayoutRecipientInvalidInput {
		t.Fatalf("expected nil database to fail closed, got %v", err)
	}
	selfRecipient := base
	selfRecipient.BeneficiaryActorID = "partner-owner"
	if _, _, err := SelectStorePayoutRecipient(t.Context(), nil, nil, selfRecipient); err != ErrStorePayoutRecipientInvalidInput {
		t.Fatalf("expected self-assignment to fail closed, got %v", err)
	}
	unverifiedFacts := validFacts
	unverifiedFacts.OfficialNameStatus = "PENDING"
	invalidFacts := base
	invalidFacts.BeneficiaryFacts = unverifiedFacts
	if _, _, err := SelectStorePayoutRecipient(t.Context(), nil, nil, invalidFacts); err != ErrStorePayoutRecipientInvalidInput {
		t.Fatalf("expected unverified beneficiary facts to fail closed, got %v", err)
	}
	if _, _, err := SelectStorePayoutRecipient(t.Context(), nil, nil, SelectStorePayoutRecipientInput{}); err != ErrStorePayoutRecipientInvalidInput {
		t.Fatal("expected empty input to fail closed")
	}
	if _, err := RevertStorePayoutRecipientToOwner(t.Context(), nil, RevertStorePayoutRecipientInput{}); err != ErrStorePayoutRecipientInvalidInput {
		t.Fatal("expected empty revert input to fail closed")
	}
	if _, err := MarkStorePayoutRecipientReviewRequired(t.Context(), nil, "", "", "", ""); err != ErrStorePayoutRecipientInvalidInput {
		t.Fatal("expected empty review input to fail closed")
	}
	if _, err := ListPartnerStorePayoutRecipients(t.Context(), nil, ""); err != ErrStorePayoutRecipientInvalidInput {
		t.Fatal("expected empty readback input to fail closed")
	}
}
