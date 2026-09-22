package postgres

import (
	"strings"
	"testing"
)

func TestValidNotificationIDSupportsFieldEvents(t *testing.T) {
	if !validNotificationID("field:42") {
		t.Fatal("expected field notification id to be valid")
	}
}

func TestFieldNotificationQueryUsesOriginatingFieldActor(t *testing.T) {
	query := visibleNotificationEvents("field")
	if query == "" || !strings.Contains(query, "joining_case_audit") || !strings.Contains(query, "originating_field_actor_id = $1") {
		t.Fatalf("field notification query does not scope to originating field actor: %q", query)
	}
}

func TestUnknownNotificationRoleHasNoVisibleEvents(t *testing.T) {
	if query := visibleNotificationEvents("operator"); query != "" {
		t.Fatalf("expected unknown notification role to have no query, got %q", query)
	}
}
