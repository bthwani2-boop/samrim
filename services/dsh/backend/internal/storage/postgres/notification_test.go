package postgres

import (
	"strings"
	"testing"
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
