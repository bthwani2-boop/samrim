package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func validIndependentCustomerPolicyDraft() IndependentCustomerPolicyDraftInput {
	return IndependentCustomerPolicyDraftInput{
		ExpectedVersion:   0,
		CancellationTerms: "Cancel before pickup confirmation",
		ReturnsTerms:      "Store reviews returned merchandise",
		FulfillmentTerms:  "Pickup at the listed store",
		CollectionTerms:   "Pay the merchant at pickup",
	}
}

func TestIndependentCustomerPolicyDraftRejectsMissingOrInvalidFields(t *testing.T) {
	for _, tt := range []struct {
		name   string
		mutate func(*IndependentCustomerPolicyDraftInput)
	}{
		{"negative version", func(p *IndependentCustomerPolicyDraftInput) { p.ExpectedVersion = -1 }},
		{"missing cancellation", func(p *IndependentCustomerPolicyDraftInput) { p.CancellationTerms = " " }},
		{"missing returns", func(p *IndependentCustomerPolicyDraftInput) { p.ReturnsTerms = "" }},
		{"missing fulfillment", func(p *IndependentCustomerPolicyDraftInput) { p.FulfillmentTerms = "x" }},
		{"missing collection", func(p *IndependentCustomerPolicyDraftInput) { p.CollectionTerms = "" }},
		{"embedded NUL", func(p *IndependentCustomerPolicyDraftInput) { p.ReturnsTerms = "ab\x00cd" }},
		{"invalid UTF8", func(p *IndependentCustomerPolicyDraftInput) { p.CancellationTerms = string([]byte{0xff, 0xfe}) }},
		{"oversized", func(p *IndependentCustomerPolicyDraftInput) { p.ReturnsTerms = strings.Repeat("A", 4001) }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			in := validIndependentCustomerPolicyDraft()
			tt.mutate(&in)
			if _, err := normalizeIndependentCustomerPolicyDraft(in); !errors.Is(err, ErrIndependentCustomerPolicyInvalid) {
				t.Fatalf("unusable merchant policy accepted: %v", err)
			}
		})
	}
}

func TestIndependentCustomerPolicyDraftNormalizesWithoutInventingApproval(t *testing.T) {
	input := validIndependentCustomerPolicyDraft()
	input.CancellationTerms = "  " + input.CancellationTerms + "  "
	normalized, err := normalizeIndependentCustomerPolicyDraft(input)
	if err != nil {
		t.Fatal(err)
	}
	if normalized.CancellationTerms != "Cancel before pickup confirmation" {
		t.Fatalf("untrimmed cancellation terms: %q", normalized.CancellationTerms)
	}
	if input.CancellationTerms == normalized.CancellationTerms {
		t.Fatal("normalization must not mutate caller-owned draft value")
	}
	_, _, err = SaveIndependentCustomerPolicyDraftForOwner(context.Background(), nil, "store-a", "owner-a", normalized,
		"draft-attempt-00000001", "correlation-0001")
	if !errors.Is(err, ErrIndependentCustomerPolicyInvalid) {
		t.Fatalf("a missing owner database must fail closed: %v", err)
	}
	if _, err := ReadIndependentCustomerPolicyForOwner(context.Background(), nil, "store-a", "owner-a"); !errors.Is(err, ErrStoreNotFound) {
		t.Fatalf("private policy read cannot proceed without database: %v", err)
	}
}

func TestIndependentCustomerPolicyDraftSchemaDoesNotGrantPublishing(t *testing.T) {
	_, statements, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(statements) < 174 {
		t.Fatal("independent Store migration 174 is missing")
	}
	schema := statements[173]
	for _, required := range []string{
		"independent_store_customer_policy_idempotency",
		"independent_store_customer_policy_audit",
		"independent_customer_policy_idem_hash_chk",
		"independent_customer_policy_audit_version_chk",
		"review_state text NOT NULL DEFAULT 'NOT_CHECKED'",
		"independent_store_customer_policy_review_chk",
	} {
		if !strings.Contains(schema, required) {
			t.Errorf("draft policy persistence is missing %q", required)
		}
	}
}
