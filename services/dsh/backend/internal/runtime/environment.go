package runtime

import (
	"fmt"
	"strings"
)

func requireOrdinaryRuntimeEnvironment(raw string) error {
	environment := strings.ToLower(strings.TrimSpace(raw))
	switch environment {
	case "development", "test":
		return nil
	case "staging", "production":
		return fmt.Errorf("dsh service runtime is blocked in %s from ordinary service execution; a controlled deployment authority is required", environment)
	default:
		return fmt.Errorf("BTHWANI_ENV must be development, test, staging, or production")
	}
}
