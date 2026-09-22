package runtime

import (
	"fmt"
	"strings"
)

func requireOrdinaryRuntimeEnvironment(raw string) error {
	environment := strings.ToLower(strings.TrimSpace(raw))
	if environment != "development" && environment != "test" {
		return fmt.Errorf("wlt service runtime is blocked outside development and test from ordinary service execution")
	}
	return nil
}
