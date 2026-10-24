package postgres

import (
	"strings"
	"testing"
)

func TestStoreAvailabilityNotificationsOperatorOnly(t *testing.T) {
	operator := visibleNotificationEvents("operator")
	if !strings.Contains(operator, "dsh.store_operational_availability_audit") || !strings.Contains(operator, "STORE_OWNER") {
		t.Fatal("operator inbox must include the canonical store availability audit")
	}
	for _, role := range []string{"partner", "client", "captain", "field"} {
		if strings.Contains(visibleNotificationEvents(role), "store_operational_availability_audit") {
			t.Fatalf("availability audit leaked into %s notifications", role)
		}
	}
}

func TestStoreAvailabilityNotificationIDValidation(t *testing.T) {
	if !validNotificationID("availability:12") {
		t.Fatal("expected store availability notification id")
	}
	for _, invalid := range []string{"availability:0", "availability:-1", "availability:abc", "availability:1:2", "other:12"} {
		if validNotificationID(invalid) {
			t.Fatalf("accepted invalid id %s", invalid)
		}
	}
}
