package transporthttp

import (
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestOperatorOperationPreservesCanonicalAuditActor(t *testing.T) {
	operation := toOperatorOperation(postgres.OperatorOperationRecord{
		History: []postgres.OperatorOperationEventRecord{
			{ID: "audit-order", Source: "order", EventType: "order_rejected", State: "REJECTED", ActorID: "partner_actor", At: time.Date(2026, 10, 20, 6, 0, 0, 0, time.UTC)},
			{ID: "audit-captain", Source: "captain", EventType: "delivery_failed", State: "delivery_failed", ActorID: "captain_actor", At: time.Date(2026, 10, 20, 6, 1, 0, 0, time.UTC)},
		},
	})
	if len(operation.History) != 2 || operation.History[0].ActorID != "partner_actor" || operation.History[1].ActorID != "captain_actor" {
		t.Fatalf("operator audit readback lost the canonical acting actors: %+v", operation.History)
	}
}
