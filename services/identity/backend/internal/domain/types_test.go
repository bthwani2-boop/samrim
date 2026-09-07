package domain

import "testing"

func TestCanonicalRoleSurfaceMapping(t *testing.T) {
	cases := map[string]string{"client": "app-client", "partner": "app-partner", "captain": "app-captain", "field": "app-field", "operator": "control-panel", "platform_owner": "control-panel"}
	for role, expected := range cases {
		actual, ok := SurfaceForRole(role)
		if !ok || actual != expected {
			t.Fatalf("role %s mapped to %q ok=%v; expected %q", role, actual, ok, expected)
		}
	}
	if _, ok := SurfaceForRole("employee"); ok {
		t.Fatal("employee must not become an authentication surface role")
	}
}

func TestTrustedCallerProvisionBoundary(t *testing.T) {
	allowed := [][2]string{{"dsh", "partner"}, {"dsh", "captain"}, {"dsh", "field"}, {"platform-control", "operator"}}
	for _, pair := range allowed {
		if !CanProvisionRole(pair[0], pair[1]) {
			t.Fatalf("expected %s to manage %s", pair[0], pair[1])
		}
	}
	denied := [][2]string{{"dsh", "operator"}, {"platform-control", "client"}, {"platform-control", "captain"}, {"platform-control", "platform_owner"}, {"browser", "operator"}}
	for _, pair := range denied {
		if CanProvisionRole(pair[0], pair[1]) {
			t.Fatalf("unexpected permission: %s can manage %s", pair[0], pair[1])
		}
	}
	if !CanBootstrapPlatformOwner("platform-bootstrap") {
		t.Fatal("bootstrap caller must be allowed on the dedicated bootstrap operation")
	}
	if CanBootstrapPlatformOwner("platform-control") {
		t.Fatal("platform-control must not access the dedicated bootstrap operation")
	}
}

func TestTrustedCallerOperationBoundaries(t *testing.T) {
	if !CanReadRole("platform-control", "client") || !CanReadRole("dsh", "partner") {
		t.Fatal("expected role reads inside caller boundaries")
	}
	for _, pair := range [][2]string{{"platform-control", "platform_owner"}, {"browser", "operator"}} {
		if CanReadRole(pair[0], pair[1]) {
			t.Fatalf("unexpected role read: %s for %s", pair[0], pair[1])
		}
	}
	if !CanResetCredential("platform-control", "operator") || CanResetCredential("platform-control", "client") {
		t.Fatal("operator credential reset must be operation-scoped")
	}
}

func TestManagedRoleBoundary(t *testing.T) {
	for _, role := range []string{"partner", "captain", "field"} {
		if !IsManagedRole(role) {
			t.Fatalf("expected managed activation role %s", role)
		}
	}
	for _, role := range []string{"client", "operator", "employee", ""} {
		if IsManagedRole(role) {
			t.Fatalf("unexpected managed activation role %q", role)
		}
	}
}

func TestManagedActivationRoleBoundary(t *testing.T) {
	for _, role := range []string{"partner", "captain", "field", "operator"} {
		if !IsManagedActivationRole(role) {
			t.Fatalf("expected managed activation role %s", role)
		}
	}
	for _, role := range []string{"client", "platform_owner", "employee", ""} {
		if IsManagedActivationRole(role) {
			t.Fatalf("unexpected managed activation role %q", role)
		}
	}
}

func TestOperatorEnrollmentTokenIssuerBoundary(t *testing.T) {
	allowed := [][2]string{
		{"platform-control", "operator"},
	}
	for _, pair := range allowed {
		if !CanIssueOperatorEnrollmentTokenForRole(pair[0], pair[1]) {
			t.Fatalf("expected %s to issue operator enrollment token for %s", pair[0], pair[1])
		}
	}
	denied := [][2]string{
		{"dsh", "partner"},
		{"dsh", "captain"},
		{"dsh", "field"},
		{"platform-control", "partner"},
		{"platform-control", "captain"},
		{"platform-control", "field"},
		{"dsh", "operator"},
		{"dsh", "platform_owner"},
		{"platform-control", "platform_owner"},
		{"browser", "captain"},
	}
	for _, pair := range denied {
		if CanIssueOperatorEnrollmentTokenForRole(pair[0], pair[1]) {
			t.Fatalf("unexpected operator-enrollment authority: %s for %s", pair[0], pair[1])
		}
	}
}
