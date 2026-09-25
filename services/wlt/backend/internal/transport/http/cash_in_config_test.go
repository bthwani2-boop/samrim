package http

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/cashin"
)

func TestCashInRailForConfig(t *testing.T) {
	tests := []struct {
		name              string
		mode              string
		environment       string
		wantEnabled       bool
		wantSimulator     bool
		wantConfiguration bool
	}{
		{name: "unset is disabled", environment: "production"},
		{name: "explicit disabled is fail closed", mode: "disabled", environment: "production"},
		{name: "development simulator", mode: "simulator", environment: "development", wantEnabled: true, wantSimulator: true},
		{name: "simulator rejected in production", mode: "simulator", environment: "production", wantConfiguration: true},
		{name: "simulator rejected in staging", mode: "simulator", environment: "staging", wantConfiguration: true},
		{name: "unknown mode rejected", mode: "provider-a", environment: "development", wantConfiguration: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rail, simulatorEnabled, err := cashInRailForConfig(test.mode, test.environment)
			if (err != nil) != test.wantConfiguration {
				t.Fatalf("configuration error = %v, want error %t", err, test.wantConfiguration)
			}
			if err != nil {
				return
			}
			if (rail != nil) != test.wantEnabled || simulatorEnabled != test.wantSimulator {
				t.Fatalf("rail enabled=%t simulator=%t; want enabled=%t simulator=%t", rail != nil, simulatorEnabled, test.wantEnabled, test.wantSimulator)
			}
			if test.wantSimulator {
				if _, ok := rail.(cashin.DevelopmentSimulator); !ok {
					t.Fatalf("development rail has type %T, want DevelopmentSimulator", rail)
				}
			}
		})
	}
}
