package storepublication

import (
	"testing"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestFieldAcquisitionReadbackMatchesPublicationFacts(t *testing.T) {
	outbox := postgres.FieldAcquisitionEntitlementOutbox{
		JoiningCaseID: "case-1", StoreID: "store-1", PartnerActorID: "partner-1", FieldActorID: "field-1",
		VerticalID: "vertical-1", CommercialStoreTypeID: "type-1",
	}
	finalized := wltintegration.FieldAcquisitionEntitlement{
		JoiningCaseID: "case-1", StoreID: "store-1", PartnerActorID: "partner-1", FieldActorID: "field-1",
		VerticalID: "vertical-1", CommercialStoreTypeID: "type-1", PolicyID: "policy-1", PolicyVersion: 2,
		RewardMinor: 250, Currency: "YER", LedgerTransactionID: "ledger-1", CreatedAt: "2026-10-04T01:02:03Z",
	}
	readback := wltintegration.FieldAcquisitionEntitlementReadback{
		JoiningCaseID: finalized.JoiningCaseID, StoreID: finalized.StoreID, PartnerActorID: finalized.PartnerActorID,
		FieldActorID: finalized.FieldActorID, VerticalID: finalized.VerticalID, CommercialStoreTypeID: finalized.CommercialStoreTypeID,
		PolicyID: finalized.PolicyID, PolicyVersion: finalized.PolicyVersion, RewardMinor: finalized.RewardMinor,
		Currency: finalized.Currency, LedgerTransactionID: finalized.LedgerTransactionID, Status: "POSTED",
		CreatedAt: finalized.CreatedAt, EffectiveAt: finalized.CreatedAt,
	}
	if !fieldAcquisitionReadbackMatches(outbox, finalized, readback) {
		t.Fatal("expected an exact posted WLT entitlement to match the publication handoff")
	}

	tests := []struct {
		name string
		edit func(*wltintegration.FieldAcquisitionEntitlementReadback)
	}{
		{"joining case mismatch", func(item *wltintegration.FieldAcquisitionEntitlementReadback) { item.JoiningCaseID = "case-other" }},
		{"store mismatch", func(item *wltintegration.FieldAcquisitionEntitlementReadback) { item.StoreID = "store-other" }},
		{"wrong status", func(item *wltintegration.FieldAcquisitionEntitlementReadback) { item.Status = "PENDING" }},
		{"ledger missing", func(item *wltintegration.FieldAcquisitionEntitlementReadback) { item.LedgerTransactionID = "" }},
		{"amount mismatch", func(item *wltintegration.FieldAcquisitionEntitlementReadback) { item.RewardMinor++ }},
		{"policy mismatch", func(item *wltintegration.FieldAcquisitionEntitlementReadback) { item.PolicyVersion++ }},
		{"time mismatch", func(item *wltintegration.FieldAcquisitionEntitlementReadback) {
			item.EffectiveAt = "2026-10-04T01:02:04Z"
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			changed := readback
			test.edit(&changed)
			if fieldAcquisitionReadbackMatches(outbox, finalized, changed) {
				t.Fatal("expected mismatched entitlement readback to remain unposted")
			}
		})
	}
}
