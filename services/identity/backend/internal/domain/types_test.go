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

func TestTrustedCallerRoleAllowlist(t *testing.T) {
	allowed := [][2]string{{"dsh", "partner"}, {"dsh", "captain"}, {"dsh", "field"}, {"platform-control", "operator"}, {"platform-control", "platform_owner"}}
	for _, pair := range allowed {
		if !RoleAllowedForCaller(pair[0], pair[1]) {
			t.Fatalf("expected %s to manage %s", pair[0], pair[1])
		}
	}
	denied := [][2]string{{"dsh", "operator"}, {"platform-control", "captain"}, {"platform-control", "client"}, {"browser", "operator"}}
	for _, pair := range denied {
		if RoleAllowedForCaller(pair[0], pair[1]) {
			t.Fatalf("unexpected permission: %s can manage %s", pair[0], pair[1])
		}
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

func TestManagedActivationCodeIssuerBoundary(t *testing.T) {
	allowed := [][2]string{
		{"dsh", "partner"},
		{"dsh", "captain"},
		{"dsh", "field"},
		{"platform-control", "partner"},
		{"platform-control", "captain"},
		{"platform-control", "field"},
		{"platform-control", "operator"},
	}
	for _, pair := range allowed {
		if !CanIssueManagedActivationCodeForRole(pair[0], pair[1]) {
			t.Fatalf("expected %s to issue activation code for %s", pair[0], pair[1])
		}
	}
	denied := [][2]string{
		{"dsh", "operator"},
		{"dsh", "platform_owner"},
		{"platform-control", "platform_owner"},
		{"browser", "captain"},
	}
	for _, pair := range denied {
		if CanIssueManagedActivationCodeForRole(pair[0], pair[1]) {
			t.Fatalf("unexpected activation-code authority: %s for %s", pair[0], pair[1])
		}
	}
}
