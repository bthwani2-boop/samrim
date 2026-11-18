package session

import (
	"errors"
	"testing"
)

func validOperatorAdminCommand() OperatorPermissionCommand {
	return OperatorPermissionCommand{
		TargetActorID:   "synthetic-operator-b",
		Permission:      "operations",
		State:           "ACTIVE",
		ExpectedVersion: 0,
		OperationID:     "operator-grant-0001",
		Reason:          "Explicit synthetic operator grant for controlled duty",
	}
}

func TestOperatorPermissionCommandRejectsMalformedScopeAndUnsafeMutation(t *testing.T) {
	if err := validateOperatorPermissionCommand(validOperatorAdminCommand()); err != nil {
		t.Fatalf("valid scoped grant rejected: %v", err)
	}
	cases := []struct {
		name   string
		change func(*OperatorPermissionCommand)
	}{
		{"missing target", func(c *OperatorPermissionCommand) { c.TargetActorID = "" }},
		{"forged SQL actor", func(c *OperatorPermissionCommand) { c.TargetActorID = "actor'; DROP TABLE roles; --" }},
		{"newline actor", func(c *OperatorPermissionCommand) { c.TargetActorID = "actor\nother" }},
		{"unknown permission", func(c *OperatorPermissionCommand) { c.Permission = "root" }},
		{"forged permission", func(c *OperatorPermissionCommand) { c.Permission = "finance,platform_policies" }},
		{"wrong-case status", func(c *OperatorPermissionCommand) { c.State = "approved" }},
		{"unknown state", func(c *OperatorPermissionCommand) { c.State = "DISABLED" }},
		{"negative expected version", func(c *OperatorPermissionCommand) { c.ExpectedVersion = -1 }},
		{"short idempotency key", func(c *OperatorPermissionCommand) { c.OperationID = "abc" }},
		{"invalid operation key", func(c *OperatorPermissionCommand) { c.OperationID = "op_id/unsafe" }},
		{"missing reason", func(c *OperatorPermissionCommand) { c.Reason = "" }},
		{"short reason", func(c *OperatorPermissionCommand) { c.Reason = "approve" }},
		{"leading spaces", func(c *OperatorPermissionCommand) { c.Reason = " " + c.Reason }},
		{"newline reason", func(c *OperatorPermissionCommand) { c.Reason = "reason\nMore text is included" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := validOperatorAdminCommand()
			tc.change(&c)
			if err := validateOperatorPermissionCommand(c); !errors.Is(err, ErrOperatorAdminInvalid) {
				t.Fatalf("command %+v error=%v; want invalid", c, err)
			}
		})
	}
	for _, scope := range []string{"operations", "partners", "catalog", "marketing", "finance", "hr", "platform_policies"} {
		c := validOperatorAdminCommand()
		c.Permission = scope
		if err := validateOperatorPermissionCommand(c); err != nil {
			t.Fatalf("finite scope %s unexpectedly invalid: %v", scope, err)
		}
	}
}

func TestOperatorPermissionCommandRequiresOwnerReadBeforeAccess(t *testing.T) {
	c := validOperatorAdminCommand()
	var reader *PostgresReader
	_, err := reader.ManageOperatorPermission(t.Context(), "Bearer invalid", c)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("invalid bearer should be rejected before any owner read: %v", err)
	}
	c.Permission = "unlisted"
	_, err = reader.ManageOperatorPermission(t.Context(), "Bearer invalid", c)
	if !errors.Is(err, ErrOperatorAdminInvalid) {
		t.Fatalf("unknown scope should be rejected before any owner read: %v", err)
	}
}
