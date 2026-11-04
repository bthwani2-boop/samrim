package storepublication

import (
	"context"
	"errors"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// A delayed Identity 404 must never turn a cancelled search with earlier
// eligible offers into a successful, partial page.
func TestPublicCatalogRejectsPartialPageAfterAuthorityCancellation(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		name := "normal-ineligible-store"
		if cancelled {
			name = "authority-cancelled-after-first-eligible-store"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			fetched := 0
			result, err := collectEligiblePublicCatalogOffers(ctx, 5, "",
				func(context.Context, int, string) (postgres.PublicCatalogSearchRecord, error) {
					fetched++
					return postgres.PublicCatalogSearchRecord{
						Offers: []postgres.CatalogStoreOfferRecord{
							{StoreID: "store-eligible"},
							{StoreID: "store-other"},
						},
					}, nil
				},
				func(_ context.Context, storeID string) (bool, error) {
					if storeID == "store-eligible" {
						return true, nil
					}
					if cancelled {
						cancel()
					}
					return false, nil // simulates Identity's 404-to-ineligible path
				},
			)
			if fetched != 1 {
				t.Fatalf("unexpected catalog scans: %d", fetched)
			}
			if cancelled {
				if !errors.Is(err, context.Canceled) || len(result.Offers) != 0 {
					t.Fatalf("cancelled search returned partial success: result=%+v err=%v", result, err)
				}
			} else if err != nil || len(result.Offers) != 1 || result.Offers[0].StoreID != "store-eligible" {
				t.Fatalf("valid partial eligible page changed: result=%+v err=%v", result, err)
			}
		})
	}
}
