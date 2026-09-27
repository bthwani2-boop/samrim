package postgres

import (
	"testing"
	"time"
)

func TestOrderConversationReadOnlyWindowStartsAfterEveryOperationalCompletion(t *testing.T) {
	updatedAt := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	for _, state := range []string{"DELIVERED", "PICKED_UP", "REJECTED", "CANCELLED"} {
		t.Run(state, func(t *testing.T) {
			order := orderConversationOrder{State: state, UpdatedAt: updatedAt}
			readOnlyAt := order.ReadOnlyAt()
			if readOnlyAt == nil || !readOnlyAt.Equal(updatedAt.Add(orderConversationGracePeriod)) {
				t.Fatalf("ReadOnlyAt() = %v, want the current grace window after completion", readOnlyAt)
			}
		})
	}

	for _, state := range []string{"CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "IN_CUSTODY", "DELIVERY_FAILED"} {
		t.Run(state, func(t *testing.T) {
			order := orderConversationOrder{State: state, UpdatedAt: updatedAt}
			if readOnlyAt := order.ReadOnlyAt(); readOnlyAt != nil {
				t.Fatalf("ReadOnlyAt() = %v for nonterminal state %q, want nil", readOnlyAt, state)
			}
		})
	}
}
