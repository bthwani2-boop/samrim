package catalog

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestQuickPriceUnchangedOnlyAtCurrentVersion(t *testing.T) {
	current := postgres.CatalogStoreOfferRecord{PriceMinor: 1500, Version: 4}
	tests := []struct {
		name            string
		priceMinor      int64
		expectedVersion int
		unchanged       bool
	}{
		{name: "current no-op", priceMinor: 1500, expectedVersion: 4, unchanged: true},
		{name: "same-key replay must consult idempotency owner", priceMinor: 1500, expectedVersion: 3},
		{name: "stale new-key request must conflict", priceMinor: 1500, expectedVersion: 2},
		{name: "new price must update", priceMinor: 1700, expectedVersion: 4},
		{name: "future version must not be a no-op", priceMinor: 1500, expectedVersion: 5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			change := postgres.CatalogQuickPriceUpdateInput{
				OfferID: "offer_one", PriceMinor: tt.priceMinor, ExpectedVersion: tt.expectedVersion,
			}
			if got := quickPriceIsUnchanged(current, change); got != tt.unchanged {
				t.Fatalf("quick-price decision = %v, want %v", got, tt.unchanged)
			}
		})
	}
}
