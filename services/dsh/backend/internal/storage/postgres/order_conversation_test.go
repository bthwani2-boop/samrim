package postgres

import (
	"errors"
	"testing"
	"time"
)

func TestOrderConversationClosesAtOperationalCompletion(t *testing.T) {
	updatedAt := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	for _, state := range []string{"DELIVERED", "PICKED_UP", "REJECTED", "CANCELLED"} {
		t.Run(state, func(t *testing.T) {
			order := orderConversationOrder{State: state, UpdatedAt: updatedAt}
			readOnlyAt := order.ReadOnlyAt()
			if readOnlyAt == nil || !readOnlyAt.Equal(updatedAt) {
				t.Fatalf("ReadOnlyAt() = %v, want immediate closure on completion", readOnlyAt)
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

func TestOrderConversationAudienceHashAndValidation(t *testing.T) {
	orderID, body := "order-a", "رسالة"
	public := HashOrderConversationMessageRequest(orderID, body)
	private := HashOrderConversationMessageRequest(orderID, body, "operator")
	if public == private {
		t.Fatal("a change in audience must change idempotency facts")
	}
	if HashOrderConversationMessageRequest(orderID, body, "partner", "operator") !=
		HashOrderConversationMessageRequest(orderID, body, "operator", "partner") {
		t.Fatal("audience order must not affect the idempotency hash")
	}
	for _, invalid := range [][]string{{"unknown"}, {"operator", "operator"}, {"client", "partner", "captain", "operator", "client"}} {
		if _, err := normalizeConversationRecipients(invalid); !errors.Is(err, ErrOrderConversationInvalid) {
			t.Fatalf("invalid roles %v not rejected: %v", invalid, err)
		}
	}
	defaultAudience, err := normalizeConversationRecipients(nil)
	if err != nil || len(defaultAudience) != 3 || hasConversationRecipient(defaultAudience, "operator") {
		t.Fatalf("legacy audience changed: %v %v", defaultAudience, err)
	}
	roles, err := normalizeConversationRecipients([]string{"operator", "partner"})
	if err != nil || len(roles) != 2 || roles[0] != "operator" || roles[1] != "partner" {
		t.Fatalf("targeted audience invalid: %v %v", roles, err)
	}
}
