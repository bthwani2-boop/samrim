package transporthttp

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
)

func TestOperatorStoreReadinessExposesAllCanonicalBlockers(t *testing.T) {
	codes := []string{storepublication.StoreScheduleNotReadyReason, storepublication.CatalogNotReadyReason, storepublication.CommercialAgreementNotReadyReason}
	mapped := toPublicationReadiness(storepublication.PublicationReadiness{Ready: false, BlockedReason: codes[0], BlockedReasons: codes})
	if mapped.Ready || string(mapped.BlockedReason) != codes[0] || len(mapped.BlockedReasons) != len(codes) {
		t.Fatalf("lost readiness flags: %+v", mapped)
	}
	for i, c := range codes {
		if string(mapped.BlockedReasons[i]) != c {
			t.Fatalf("mismatch at %d: %s", i, mapped.BlockedReasons[i])
		}
	}
}
