package postgres

import (
	"database/sql"
	"testing"
)

func TestDiscoveryContentEventCanonicalReplayFacts(t *testing.T) {
	original := DiscoveryContentEventInput{
		ID: "event-1", ClientEventID: "client-event-1", ContentID: "content-1",
		EventType: "CONVERSION", ClientSessionID: "session-1234567890",
		ClientActorID: "customer-1", OrderID: "order-1",
	}
	actor := sql.NullString{String: "customer-1", Valid: true}
	order := sql.NullString{String: "order-1", Valid: true}
	tests := []struct {
		name     string
		change   func(*DiscoveryContentEventInput)
		content  string
		actor    sql.NullString
		order    sql.NullString
		expected bool
	}{
		{"exact conversion replay", nil, "content-1", actor, order, true},
		{"different content on same event ID", nil, "content-2", actor, order, false},
		{"different event type", func(v *DiscoveryContentEventInput) { v.EventType = "CLICK" }, "content-1", actor, order, false},
		{"different session", func(v *DiscoveryContentEventInput) { v.ClientSessionID = "session-0000000000" }, "content-1", actor, order, false},
		{"different customer", func(v *DiscoveryContentEventInput) { v.ClientActorID = "customer-2" }, "content-1", actor, order, false},
		{"different order", func(v *DiscoveryContentEventInput) { v.OrderID = "order-2" }, "content-1", actor, order, false},
		{"missing actor", nil, "content-1", sql.NullString{}, order, false},
		{"missing order", nil, "content-1", actor, sql.NullString{}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			input := original
			if tc.change != nil {
				tc.change(&input)
			}
			if got := discoveryEventFactsMatch(input, tc.content, original.EventType, original.ClientSessionID, tc.actor, tc.order); got != tc.expected {
				t.Fatalf("event facts match=%t, expected=%t", got, tc.expected)
			}
		})
	}
	for _, eventType := range []string{"IMPRESSION", "CLICK"} {
		t.Run("anonymous "+eventType, func(t *testing.T) {
			input := DiscoveryContentEventInput{ContentID: "content-1", EventType: eventType, ClientSessionID: "session-1234567890"}
			if !discoveryEventFactsMatch(input, input.ContentID, input.EventType, input.ClientSessionID, sql.NullString{}, sql.NullString{}) {
				t.Fatal("anonymous event replay must match SQL NULL actor and order")
			}
			if discoveryEventFactsMatch(input, input.ContentID, input.EventType, input.ClientSessionID, sql.NullString{Valid: true}, sql.NullString{}) {
				t.Fatal("SQL empty string is not the same as NULL actor")
			}
		})
	}
}
