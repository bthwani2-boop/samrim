package transporthttp

import (
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
)

func TestFieldJoiningCaseViewIncludesCanonicalStoreWhenReadinessIsKnown(t *testing.T) {
	now := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	result := postgres.JoiningCaseResult{Case: postgres.JoiningCaseRecord{
		ID: "case-approved", State: "approved", PartnerActorID: "actor-partner",
		Store: &postgres.StoreRecord{
			ID: "store-approved", PartnerActorID: "actor-partner",
			Name: "متجر الاختبار", FulfillmentModes: []string{"BTHWANI_CAPTAIN"},
			PublicationState: "unpublished", Version: 2, CreatedAt: now, UpdatedAt: now,
		},
	}}
	readiness := &storepublication.PublicationReadiness{Ready: false, BlockedReason: "CATALOG_NOT_READY"}
	view := toFieldJoiningCaseView(result, readiness)
	if view.Store == nil {
		t.Fatal("approved field case omitted its canonical store")
	}
	if view.Store.ID != "store-approved" || view.Store.PartnerActorID != "actor-partner" {
		t.Fatalf("unexpected store ownership: %+v", view.Store)
	}
	if view.Store.PublicationState != "unpublished" || len(view.Store.FulfillmentModes) != 1 || view.Store.FulfillmentModes[0] != "BTHWANI_CAPTAIN" {
		t.Fatalf("canonical store properties lost: %+v", view.Store)
	}
	if view.Store.PublicationReadiness.Ready || view.Store.PublicationReadiness.BlockedReason != "CATALOG_NOT_READY" {
		t.Fatalf("readiness must match the owner evaluation: %+v", view.Store.PublicationReadiness)
	}
	if noReadiness := toFieldJoiningCaseView(result, nil); noReadiness.Store != nil {
		t.Fatal("store readiness must not be fabricated for other response paths")
	}
	result.Case.Store = nil
	if noStore := toFieldJoiningCaseView(result, readiness); noStore.Store != nil {
		t.Fatal("unapproved/no-store result must not fabricate a store")
	}
}
