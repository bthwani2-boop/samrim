package postgres_test

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func testDeliveryProofKeyring(t *testing.T) *postgres.DeliveryProofKeyring {
	t.Helper()
	keys, err := postgres.NewDeliveryProofKeyring("test-v1", map[string]string{
		"test-v1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
	})
	if err != nil {
		t.Fatalf("create test delivery proof keyring: %v", err)
	}
	return keys
}
