package opsafety

import (
	"strings"
	"testing"
)

func TestOrdinaryCLIEnvironmentAllowsOnlyDevelopmentAndTest(t *testing.T) {
	for _, environment := range []string{"development", "test"} {
		if got, err := RequireOrdinaryCLIEnvironment(environment, "test operation"); err != nil || got != environment {
			t.Fatalf("environment %s should be allowed: got=%q err=%v", environment, got, err)
		}
	}
}

func TestOrdinaryCLIEnvironmentBlocksStagingAndProduction(t *testing.T) {
	for _, environment := range []string{"staging", "production"} {
		if _, err := RequireOrdinaryCLIEnvironment(environment, "identity migration"); err == nil || !strings.Contains(err.Error(), "blocked") {
			t.Fatalf("environment %s was not blocked: %v", environment, err)
		}
	}
}

func TestExpectedDatabaseTargetRequiresIndependentIdentity(t *testing.T) {
	getenv := func(string) string { return "" }
	_, err := RequireExpectedDatabaseTarget("postgres://samrim_local:secret@127.0.0.1:55432/samrim_local?sslmode=disable", getenv)
	if err == nil || !strings.Contains(err.Error(), "explicit database target identity") {
		t.Fatalf("missing expected target identity was accepted: %v", err)
	}
}

func TestExpectedDatabaseTargetRejectsMismatchWithoutLeakingPassword(t *testing.T) {
	values := map[string]string{
		expectedDatabaseHostEnv: "127.0.0.1",
		expectedDatabasePortEnv: "55432",
		expectedDatabaseNameEnv: "other_database",
		expectedDatabaseUserEnv: "samrim_local",
	}
	getenv := func(name string) string { return values[name] }
	_, err := RequireExpectedDatabaseTarget("postgres://samrim_local:super-secret-password@127.0.0.1:55432/samrim_local?sslmode=disable", getenv)
	if err == nil || !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("database mismatch was accepted: %v", err)
	}
	if strings.Contains(err.Error(), "super-secret-password") {
		t.Fatalf("database target error leaked password: %v", err)
	}
}

func TestExpectedDatabaseTargetAcceptsExactIdentity(t *testing.T) {
	values := map[string]string{
		expectedDatabaseHostEnv: "postgres",
		expectedDatabasePortEnv: "5432",
		expectedDatabaseNameEnv: "samrim_local",
		expectedDatabaseUserEnv: "samrim_local",
	}
	getenv := func(name string) string { return values[name] }
	target, err := RequireExpectedDatabaseTarget("postgres://samrim_local:secret@postgres:5432/samrim_local?sslmode=disable", getenv)
	if err != nil {
		t.Fatalf("exact target rejected: %v", err)
	}
	if target.Host != "postgres" || target.Port != "5432" || target.Name != "samrim_local" || target.User != "samrim_local" {
		t.Fatalf("unexpected parsed target: %+v", target)
	}
}
