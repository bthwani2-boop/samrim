package opsafety

import (
	"strings"
	"testing"
)

func expectedWLTDatabaseEnv(key string) string {
	switch key {
	case "BTHWANI_EXPECTED_DATABASE_HOST":
		return "db.internal"
	case "BTHWANI_EXPECTED_DATABASE_PORT":
		return "5432"
	case "BTHWANI_EXPECTED_DATABASE_NAME":
		return "wlt"
	case "BTHWANI_EXPECTED_DATABASE_USER":
		return "wlt_app"
	default:
		return ""
	}
}

func TestRequireExpectedDatabaseTargetRejectsQueryTargetOverrides(t *testing.T) {
	const target = "postgres://wlt_app:proof@db.internal:5432/wlt"
	for _, suffix := range []string{
		"host=external.internal",
		"hostaddr=10.10.10.10",
		"port=5433",
		"user=other_role",
		"dbname=other_database",
		"database=other_database",
		"service=external",
		"HOST=db.internal",
		"sslmode=disable&host=external.internal",
		"sslmode=disable&host=%GG",
	} {
		t.Run(strings.Split(suffix, "=")[0], func(t *testing.T) {
			if _, err := RequireExpectedDatabaseTarget(target+"?"+suffix, expectedWLTDatabaseEnv); err == nil {
				t.Fatalf("connection identity query override must be rejected: %s", suffix)
			}
		})
	}
}

func TestRequireExpectedDatabaseTargetAllowsNonIdentityOptions(t *testing.T) {
	got, err := RequireExpectedDatabaseTarget("postgres://wlt_app:proof@db.internal/wlt?sslmode=disable&connect_timeout=5", expectedWLTDatabaseEnv)
	if err != nil {
		t.Fatalf("legitimate non-target options were rejected: %v", err)
	}
	if got.Host != "db.internal" || got.Port != "5432" || got.Name != "wlt" || got.User != "wlt_app" {
		t.Fatalf("incorrect target readback: %+v", got)
	}
}
