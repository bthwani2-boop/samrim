package domain

import "testing"

func TestCanonicalRoleSurfaceMapping(t *testing.T) {
	cases := map[string]string{
		"client":   "app-client",
		"partner":  "app-partner",
		"captain":  "app-captain",
		"field":    "app-field",
		"operator": "control-panel",
	}
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
	allowed := [][2]string{{"workforce", "captain"}, {"workforce", "field"}, {"dsh", "partner"}, {"platform-control", "operator"}}
	for _, pair := range allowed {
		if !RoleAllowedForCaller(pair[0], pair[1]) {
			t.Fatalf("expected %s to provision %s", pair[0], pair[1])
		}
	}
	denied := [][2]string{{"workforce", "partner"}, {"dsh", "captain"}, {"platform-control", "client"}, {"browser", "operator"}}
	for _, pair := range denied {
		if RoleAllowedForCaller(pair[0], pair[1]) {
			t.Fatalf("unexpected permission: %s can provision %s", pair[0], pair[1])
		}
	}
}
