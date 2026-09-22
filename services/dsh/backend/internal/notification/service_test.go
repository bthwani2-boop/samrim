package notification

import "testing"

func TestValidNotificationSessionAcceptsFieldSurface(t *testing.T) {
	if !validNotificationSession("field-actor-1", "field", "app-field") {
		t.Fatal("expected app-field field session to be accepted")
	}
}

func TestValidNotificationSessionAcceptsOperatorSurface(t *testing.T) {
	if !validNotificationSession("operator-actor-1", "operator", "control-panel") {
		t.Fatal("expected control-panel operator session to be accepted")
	}
}

func TestValidNotificationSessionRejectsCrossSurfaceSession(t *testing.T) {
	if validNotificationSession("field-actor-1", "field", "app-partner") {
		t.Fatal("expected field session on another surface to be rejected")
	}
}
