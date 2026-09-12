package runtime

import (
	"strings"
	"testing"
)

func TestOrdinaryRuntimeEnvironmentAllowsDevelopmentAndTest(t *testing.T) {
	for _, environment := range []string{"development", "test"} {
		if err := requireOrdinaryRuntimeEnvironment(environment); err != nil {
			t.Fatalf("environment %s should be allowed: %v", environment, err)
		}
	}
}

func TestOrdinaryRuntimeEnvironmentBlocksStagingAndProduction(t *testing.T) {
	for _, environment := range []string{"staging", "production"} {
		err := requireOrdinaryRuntimeEnvironment(environment)
		if err == nil || !strings.Contains(err.Error(), "blocked") {
			t.Fatalf("environment %s was not blocked: %v", environment, err)
		}
	}
}

func TestOrdinaryRuntimeEnvironmentRequiresExplicitClass(t *testing.T) {
	if err := requireOrdinaryRuntimeEnvironment(""); err == nil {
		t.Fatal("missing BTHWANI_ENV was accepted")
	}
}
