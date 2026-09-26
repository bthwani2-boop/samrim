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

func TestStorePickupNotificationCopyIsSpecificToEachActor(t *testing.T) {
	tests := []struct {
		eventType string
		role      string
		kind      string
		title     string
		body      string
	}{
		{"order_ready_for_pickup", "client", "ORDER_READY_FOR_PICKUP", "طلبك جاهز للاستلام", "الطلب رقم order-123 جاهز للاستلام من المتجر."},
		{"order_ready_for_pickup", "partner", "ORDER_READY_FOR_PICKUP", "الطلب جاهز ليستلمه العميل", "الطلب رقم order-123 جاهز ليستلمه العميل من متجرك."},
		{"order_picked_up", "client", "ORDER_PICKED_UP", "تم استلام طلبك", "تم استلام الطلب رقم order-123 من المتجر."},
		{"order_picked_up", "partner", "ORDER_PICKED_UP", "استلم العميل الطلب", "استلم العميل الطلب رقم order-123 من متجرك."},
	}
	for _, test := range tests {
		t.Run(test.eventType+"/"+test.role, func(t *testing.T) {
			kind, title, body := message(test.eventType, test.role, "order-123")
			if kind != test.kind || title != test.title || body != test.body {
				t.Fatalf("message(%q, %q) = (%q, %q, %q), want (%q, %q, %q)", test.eventType, test.role, kind, title, body, test.kind, test.title, test.body)
			}
		})
	}
}
