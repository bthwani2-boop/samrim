package storepublication

import (
	"strings"
	"time"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func fieldAcquisitionReadbackMatches(outbox postgres.FieldAcquisitionEntitlementOutbox, finalized wltintegration.FieldAcquisitionEntitlement, readback wltintegration.FieldAcquisitionEntitlementReadback) bool {
	if readback.JoiningCaseID != outbox.JoiningCaseID || finalized.JoiningCaseID != outbox.JoiningCaseID ||
		readback.StoreID != outbox.StoreID || finalized.StoreID != outbox.StoreID ||
		readback.PartnerActorID != outbox.PartnerActorID || finalized.PartnerActorID != outbox.PartnerActorID ||
		readback.FieldActorID != outbox.FieldActorID || finalized.FieldActorID != outbox.FieldActorID ||
		readback.VerticalID != outbox.VerticalID || finalized.VerticalID != outbox.VerticalID ||
		readback.CommercialStoreTypeID != outbox.CommercialStoreTypeID || finalized.CommercialStoreTypeID != outbox.CommercialStoreTypeID ||
		readback.PolicyID == "" || finalized.PolicyID != readback.PolicyID ||
		readback.PolicyVersion < 1 || finalized.PolicyVersion != readback.PolicyVersion ||
		readback.RewardMinor <= 0 || finalized.RewardMinor != readback.RewardMinor ||
		readback.Currency != "YER" || finalized.Currency != readback.Currency ||
		readback.LedgerTransactionID == "" || finalized.LedgerTransactionID != readback.LedgerTransactionID ||
		readback.Status != "POSTED" || strings.TrimSpace(readback.CreatedAt) == "" || readback.CreatedAt != finalized.CreatedAt ||
		strings.TrimSpace(readback.EffectiveAt) == "" || readback.EffectiveAt != readback.CreatedAt {
		return false
	}
	if _, err := time.Parse(time.RFC3339Nano, readback.CreatedAt); err != nil {
		return false
	}
	return true
}
