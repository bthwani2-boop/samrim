package postgres_test

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestNormalizeWalletProviderKey(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  string
		valid bool
	}{
		{name: "trims surrounding spaces", value: "  wallet_provider_floosak  ", want: "wallet_provider_floosak", valid: true},
		{name: "rejects empty", value: " \t ", valid: false},
		{name: "rejects control characters", value: "provider\nkey", valid: false},
		{name: "rejects over limit", value: "12345678901234567890123456789012345678901234567890123456789012345", valid: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, valid := postgres.NormalizeWalletProviderKey(test.value)
			if got != test.want || valid != test.valid {
				t.Fatalf("NormalizeWalletProviderKey(%q) = (%q, %v), want (%q, %v)", test.value, got, valid, test.want, test.valid)
			}
		})
	}
}
