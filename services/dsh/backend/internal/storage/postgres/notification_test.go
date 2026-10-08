package postgres

import (
	"strings"
	"testing"
	"time"
)

func TestValidNotificationIDSupportsCurrentEventSources(t *testing.T) {
	for _, id := range []string{"field:42", "store:43"} {
		if !validNotificationID(id) {
			t.Fatalf("expected notification id %q to be valid", id)
		}
	}
	for _, id := range []string{"store:0", "store:nope", "unknown:1"} {
		if validNotificationID(id) {
			t.Fatalf("expected notification id %q to be invalid", id)
		}
	}
}

func TestFieldNotificationQueryUsesOriginatingFieldActor(t *testing.T) {
	query := visibleNotificationEvents("field")
	if query == "" || !strings.Contains(query, "joining_case_audit") || !strings.Contains(query, "originating_field_actor_id = $1") {
		t.Fatalf("field notification query does not scope to originating field actor: %q", query)
	}
	if !strings.Contains(query, "store_go_live_notifications") || !strings.Contains(query, "actor_role='field'") {
		t.Fatalf("field notification query does not include only the Field go-live recipient: %q", query)
	}
}

func TestPartnerNotificationQueryIncludesOwnedStoreGoLiveEvents(t *testing.T) {
	query := visibleNotificationEvents("partner")
	if !strings.Contains(query, "store_go_live_notifications") || !strings.Contains(query, "actor_role='partner'") || !strings.Contains(query, "notification.actor_id=$1") {
		t.Fatalf("partner notification query does not scope go-live events to the current Partner: %q", query)
	}
}

func TestOperatorNotificationQueryIncludesAllOperationalAudits(t *testing.T) {
	query := visibleNotificationEvents("operator")
	for _, table := range []string{"commerce_order_audit", "captain_audit", "joining_case_audit"} {
		if !strings.Contains(query, table) {
			t.Fatalf("operator notification query does not include %s: %q", table, query)
		}
	}
}

func TestUnknownNotificationRoleHasNoVisibleEvents(t *testing.T) {
	if query := visibleNotificationEvents("unknown"); query != "" {
		t.Fatalf("expected unknown notification role to have no query, got %q", query)
	}
}

func TestNotificationCursorBindsActorAndRole(t *testing.T) {
	cursor := notificationCursor{Version: 1, ActorID: "field-a", Role: "field", CreatedAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), ID: "field:42"}
	raw := encodeNotificationCursor(cursor)
	if _, err := decodeNotificationCursor(raw, "field-a", "field"); err != nil {
		t.Fatalf("decode matching cursor: %v", err)
	}
	for _, scope := range [][2]string{{"field-b", "field"}, {"field-a", "operator"}} {
		if _, err := decodeNotificationCursor(raw, scope[0], scope[1]); err != ErrNotificationInvalidCursor {
			t.Fatalf("decode cursor in scope %v returned %v, want invalid cursor", scope, err)
		}
	}
	invalidID := encodeNotificationCursor(notificationCursor{Version: 1, ActorID: "field-a", Role: "field", CreatedAt: cursor.CreatedAt, ID: "field:0"})
	staleVersion := encodeNotificationCursor(notificationCursor{Version: 0, ActorID: "field-a", Role: "field", CreatedAt: cursor.CreatedAt, ID: "field:42"})
	for _, value := range []string{"%%%", invalidID, staleVersion} {
		if _, err := decodeNotificationCursor(value, "field-a", "field"); err != ErrNotificationInvalidCursor {
			t.Fatalf("decode invalid cursor returned %v, want invalid cursor", err)
		}
	}
}

func TestNotificationSourceQueriesKeepNavigationRefsAndReadTimestamp(t *testing.T) {
	for _, role := range []string{"client", "partner", "captain", "field", "operator"} {
		query := visibleNotificationEvents(role)
		if !strings.Contains(query, "AS joining_case_id") || !strings.Contains(query, "AS store_id") {
			t.Fatalf("%s query omits navigation columns: %q", role, query)
		}
	}
	field := visibleNotificationEvents("field")
	if !strings.Contains(field, "audit.case_id::text AS joining_case_id") || !strings.Contains(field, "notification.store_id") {
		t.Fatalf("field source references are missing: %q", field)
	}
	operator := visibleNotificationEvents("operator")
	if !strings.Contains(operator, "JOIN dsh.joining_cases cases ON cases.id = audit.case_id") {
		t.Fatalf("operator joining case source does not carry store navigation: %q", operator)
	}
	if strings.Contains(markNotificationReadSQL, "EXCLUDED.read_at") || !strings.Contains(markNotificationReadSQL, "read_at = existing.read_at") {
		t.Fatal("mark-read conflict handling must preserve the first read timestamp")
	}
}
