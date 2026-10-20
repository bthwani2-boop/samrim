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
