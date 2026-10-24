package notification

import "testing"

func TestNotificationSessionRequiresExactRoleSurfacePair(t *testing.T) {
	permitted := map[string]string{
		"client":   "app-client",
		"partner":  "app-partner",
		"captain":  "app-captain",
		"field":    "app-field",
		"operator": "control-panel",
	}
	for role, surface := range permitted {
		if !validNotificationSession("actor-1", role, surface) {
			t.Fatalf("valid %s notification session was rejected", role)
		}
		for otherRole, otherSurface := range permitted {
			if otherRole == role {
				continue
			}
			if validNotificationSession("actor-1", role, otherSurface) {
				t.Fatalf("%s session incorrectly accepted %s surface", role, otherSurface)
			}
		}
		if validNotificationSession("", role, surface) {
			t.Fatalf("%s accepts missing subject", role)
		}
	}
	for _, invalid := range []string{"", "customer", "root", "admin"} {
		if validNotificationSession("actor-1", invalid, "control-panel") {
			t.Fatalf("invalid role %q accepted", invalid)
		}
	}
}

func TestNotificationPresentationDifferentiatesClientAndPartner(t *testing.T) {
	clientKind, clientTitle, clientBody := message("order_created", "client", "order-123", "")
	partnerKind, partnerTitle, partnerBody := message("order_created", "partner", "order-123", "")
	if clientKind != "ORDER_CREATED" || partnerKind != "ORDER_CREATED" {
		t.Fatalf("unexpected event kinds: client=%q partner=%q", clientKind, partnerKind)
	}
	if clientTitle == partnerTitle || clientBody == partnerBody {
		t.Fatalf("order creation notifications must reflect the recipient's role")
	}
	if _, _, body := message("dispatch_offer_created", "captain", "order-123", ""); body != "لديك عرض توصيل جديد للطلب رقم order-123." {
		t.Fatalf("captain offer notification changed its public, order-only body: %q", body)
	}
}

func TestNotificationPresentationReportsCancelledOrderWithoutPaymentClaim(t *testing.T) {
	for _, role := range []string{"client", "partner", "operator"} {
		kind, title, body := message("order_cancelled", role, "order-123", "CANCELLED")
		if kind != "ORDER_STATUS" || title != "تم إلغاء الطلب" || body != "تم إلغاء الطلب رقم order-123." {
			t.Fatalf("%s cancellation notification misrepresents the state: kind=%q title=%q body=%q", role, kind, title, body)
		}
	}
	_, title, body := message("order_rejected", "client", "order-123", "REJECTED")
	if title != "تعذر قبول الطلب" || body != "تعذر قبول الطلب رقم order-123." {
		t.Fatalf("rejection notification changed while adding cancellation: title=%q body=%q", title, body)
	}
}

func TestDeliveryArrivalNotificationOnlyWhenCaptainConfirms(t *testing.T) {
	kind, title, body := message("captain_arrived_dropoff", "client", "order-123", "arrived")
	if kind != "CAPTAIN_ARRIVED" || title == "" || body == "" {
		t.Fatalf("explicit arrival must yield a distinct customer alert: %q %q %q", kind, title, body)
	}
	kind, _, _ = message("captain_pickup_completed", "client", "order-123", "in_custody")
	if kind == "CAPTAIN_ARRIVED" {
		t.Fatal("pickup is not a delivery arrival")
	}
}
