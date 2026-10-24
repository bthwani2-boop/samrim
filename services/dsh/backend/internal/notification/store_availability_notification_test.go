package notification

import "testing"

func TestOperatorStoreAvailabilityMessage(t *testing.T) {
	kind, title, body := message("operational_availability_changed", "operator", "", "changed")
	if kind != "STORE_AVAILABILITY_CHANGED" || title == "" || body == "" {
		t.Fatalf("operator notification invalid: kind=%q title=%q body=%q", kind, title, body)
	}
}
