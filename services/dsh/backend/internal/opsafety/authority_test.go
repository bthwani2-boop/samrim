package opsafety

import (
	"strings"
	"testing"
)

func expectedDatabaseEnv(name string) string {
	switch name {
	case expectedDatabaseHostEnv:
		return "db.internal"
	case expectedDatabasePortEnv:
		return "5432"
	case expectedDatabaseNameEnv:
		return "dsh"
	case expectedDatabaseUserEnv:
		return "dsh_app"
	}
	return ""
}

func TestRequireExpectedDatabaseTargetRejectsConnectionIdentityOverrides(t *testing.T) {
	const base = "postgresql://dsh_app:test@db.internal:5432/dsh"
	for _, query := range []string{
		"host=external.internal",
		"hostaddr=10.10.10.10",
		"port=5433",
		"user=other_role",
		"dbname=other_database",
		"database=other_database",
		"service=external",
		"sslmode=disable&host=external.internal",
		"sslmode=disable&host=%GG",
	} {
		t.Run(strings.Split(query, "=")[0], func(t *testing.T) {
			if _, err := RequireExpectedDatabaseTarget(base+"?"+query, expectedDatabaseEnv); err == nil {
				t.Fatalf("identity-altering or malformed connection query must be rejected: %s", query)
			}
		})
	}
}

func TestRequireExpectedDatabaseTargetAllowsNonIdentityOptions(t *testing.T) {
	target, err := RequireExpectedDatabaseTarget("postgresql://dsh_app:test@db.internal:5432/dsh?sslmode=disable&connect_timeout=5", expectedDatabaseEnv)
	if err != nil {
		t.Fatalf("legitimate connection options must remain available: %v", err)
	}
	if target.Host != "db.internal" || target.Port != "5432" || target.Name != "dsh" || target.User != "dsh_app" {
		t.Fatalf("unexpected database identity: %+v", target)
	}
}
