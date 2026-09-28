package domain

import "testing"

func TestCanonicalRoleSurfaceMapping(t *testing.T) {
	cases := map[string]string{"client": "app-client", "partner": "app-partner", "captain": "app-captain", "field": "app-field", "operator": "control-panel"}
	for role, expected := range cases {
		actual, ok := SurfaceForRole(role)
		if !ok || actual != expected {
			t.Fatalf("role %s mapped to %q ok=%v; expected %q", role, actual, ok, expected)
		}
	}
	for _, retired := range []string{"operator_owner", "employee"} {
		if _, ok := SurfaceForRole(retired); ok {
			t.Fatalf("retired/noncanonical role %q must not map to a surface", retired)
		}
	}
}

func TestTrustedCallerProvisionBoundary(t *testing.T) {
	allowed := [][2]string{{"dsh", "partner"}, {"dsh", "captain"}, {"dsh", "field"}}
	for _, pair := range allowed {
		if !CanProvisionRole(pair[0], pair[1]) {
			t.Fatalf("expected %s to manage %s", pair[0], pair[1])
		}
	}
	denied := [][2]string{{"dsh", "operator"}, {"control-panel", "client"}, {"control-panel", "operator"}, {"control-panel", "captain"}, {"control-panel", "field"}, {"browser", "operator"}}
	for _, pair := range denied {
		if CanProvisionRole(pair[0], pair[1]) {
			t.Fatalf("unexpected permission: %s can manage %s", pair[0], pair[1])
		}
	}
	if !CanBootstrapFirstOperator("operator-bootstrap") {
		t.Fatal("operator bootstrap caller must be allowed on the dedicated bootstrap operation")
	}
	if CanBootstrapFirstOperator("control-panel") {
		t.Fatal("control-panel must not access the dedicated first-operator bootstrap operation")
	}
}

func TestTrustedCallerOperationBoundaries(t *testing.T) {
	if !CanReadRole("control-panel", "client") || !CanReadRole("dsh", "partner") || !CanReadRole("dsh", "captain") || !CanReadRole("dsh", "operator") {
		t.Fatal("expected role reads inside caller boundaries")
	}
	for _, pair := range [][2]string{{"browser", "operator"}} {
		if CanReadRole(pair[0], pair[1]) {
			t.Fatalf("unexpected role read: %s for %s", pair[0], pair[1])
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
	for _, role := range []string{"partner", "captain", "field"} {
		if !IsManagedActivationRole(role) {
			t.Fatalf("expected managed activation role %s", role)
		}
	}
	for _, role := range []string{"client", "operator_owner", "employee", ""} {
		if IsManagedActivationRole(role) {
			t.Fatalf("unexpected managed activation role %q", role)
		}
	}
}

func TestOperatorEnrollmentTokenIssuerBoundary(t *testing.T) {
	if !CanIssueOperatorEnrollmentTokenForRole("control-panel", "operator") {
		t.Fatal("control-panel must be able to issue operator enrollment tokens")
	}
	denied := [][2]string{
		{"dsh", "partner"},
		{"dsh", "captain"},
		{"dsh", "field"},
		{"control-panel", "partner"},
		{"control-panel", "captain"},
		{"control-panel", "field"},
		{"control-panel", "client"},
		{"browser", "captain"},
	}
	for _, pair := range denied {
		if CanIssueOperatorEnrollmentTokenForRole(pair[0], pair[1]) {
			t.Fatalf("unexpected operator-enrollment authority: %s for %s", pair[0], pair[1])
		}
	}
}

func TestControlPanelRoleBoundary(t *testing.T) {
	if !IsControlPanelRole("operator") {
		t.Fatal("operator must be the control-panel human role")
	}
	for _, role := range []string{"operator_owner", "client", "partner", "captain", "field", ""} {
		if IsControlPanelRole(role) {
			t.Fatalf("unexpected control-panel role %q", role)
		}
	}
}

func TestOperatorWorkspacePermissionRegistry(t *testing.T) {
	want := []string{"operations", "partners", "catalog", "marketing", "finance", "platform_policies"}
	got := OperatorPermissions()
	if len(got) != len(want) {
		t.Fatalf("operator workspace permission count = %d; want %d", len(got), len(want))
	}
	for index, permission := range want {
		if got[index] != permission || !IsOperatorPermission(permission) {
			t.Fatalf("operator workspace permission[%d] = %q; want recognized %q", index, got[index], permission)
		}
	}
	for _, invalid := range []string{"access", "leadership", "partner", "captain", "field", ""} {
		if IsOperatorPermission(invalid) {
			t.Fatalf("unexpected Operator workspace permission %q", invalid)
		}
	}
}

func TestManagedRoleSecurityMutationBoundary(t *testing.T) {
	if !CanSetRoleEnabled("dsh", "partner") || !CanSetRoleEnabled("dsh", "captain") {
		t.Fatal("DSH must own managed-role security transitions")
	}
	if !CanSetRoleEnabled("dsh", "field") || CanSetRoleEnabled("control-panel", "partner") || CanSetRoleEnabled("control-panel", "captain") || CanSetRoleEnabled("control-panel", "field") {
		t.Fatal("managed-role security transitions must not bypass the owning DSH boundary")
	}
}

func TestManagedRoleReenrollmentBoundary(t *testing.T) {
	for _, role := range []string{"partner", "captain", "field"} {
		if !CanAuthorizeReenrollment("dsh", role) {
			t.Fatalf("DSH must authorize %s reenrollment after current domain eligibility is verified", role)
		}
		if CanAuthorizeReenrollment("control-panel", role) {
			t.Fatalf("Control Panel must not bypass DSH eligibility for %s reenrollment", role)
		}
	}
	if CanAuthorizeReenrollment("identity", "partner") || CanAuthorizeReenrollment("dsh", "client") || CanAuthorizeReenrollment("dsh", "operator") {
		t.Fatal("reenrollment must remain limited to DSH-managed roles and their lifecycle owner")
	}
}
