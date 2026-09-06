package lifecycle

import "testing"

func TestConfigFromEnvironmentRequiresGovernedProductionValues(t *testing.T) {
	values := map[string]string{
		"IDENTITY_RETENTION_CHALLENGE_DAYS":        "30",
		"IDENTITY_RETENTION_PASSWORD_ATTEMPT_DAYS": "30",
		"IDENTITY_RETENTION_ACTIVATION_DAYS":       "30",
		"IDENTITY_RETENTION_SESSION_DAYS":          "90",
		"IDENTITY_RETENTION_AUDIT_DAYS":            "365",
		"IDENTITY_RETENTION_BATCH_SIZE":            "500",
	}
	getenv := func(key string) string { return values[key] }
	config, err := ConfigFromEnvironment(getenv, true)
	if err != nil {
		t.Fatal(err)
	}
	if config.BatchSize != 500 || config.Session.Hours() != 90*24 || config.Audit.Hours() != 365*24 {
		t.Fatalf("unexpected retention config: %+v", config)
	}
	delete(values, "IDENTITY_RETENTION_AUDIT_DAYS")
	if _, err := ConfigFromEnvironment(getenv, true); err == nil {
		t.Fatal("production retention accepted a missing governed class")
	}
}

func TestConfigFromEnvironmentRejectsUnboundedBatch(t *testing.T) {
	values := map[string]string{"IDENTITY_RETENTION_BATCH_SIZE": "10001"}
	if _, err := ConfigFromEnvironment(func(key string) string { return values[key] }, false); err == nil {
		t.Fatal("retention accepted an unbounded batch size")
	}
}
