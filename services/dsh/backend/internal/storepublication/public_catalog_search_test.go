package storepublication

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestPublicProductSearchSkipsIneligibleStoresWithoutHidingLaterOffers(t *testing.T) {
	records := []postgres.CatalogStoreOfferRecord{
		{ID: "offer-1", StoreID: "hidden-1"},
		{ID: "offer-2", StoreID: "hidden-2"},
		{ID: "offer-3", StoreID: "visible-1"},
		{ID: "offer-4", StoreID: "visible-1"},
	}
	calls, checks := 0, map[string]int{}
	fetch := func(_ context.Context, limit int, cursor string) (postgres.PublicCatalogSearchRecord, error) {
		calls++
		start := 0
		if cursor != "" {
			n, err := strconv.Atoi(cursor)
			if err != nil {
				return postgres.PublicCatalogSearchRecord{}, err
			}
			start = n
		}
		end := min(start+limit, len(records))
		page := postgres.PublicCatalogSearchRecord{Offers: records[start:end]}
		if end < len(records) {
			next := strconv.Itoa(end)
			page.NextCursor = &next
		}
		return page, nil
	}
	eligible := func(_ context.Context, store string) (bool, error) {
		checks[store]++
		return strings.HasPrefix(store, "visible-"), nil
	}
	first, err := collectEligiblePublicCatalogOffers(context.Background(), 2, "", fetch, eligible)
	if err != nil || len(first.Offers) != 2 || first.Offers[0].ID != "offer-3" || first.Offers[1].ID != "offer-4" || first.NextCursor != nil {
		t.Fatalf("eligible search page omitted later products: %+v err=%v", first, err)
	}
	if calls != 2 || checks["visible-1"] != 1 {
		t.Fatalf("ineligible scan or per-store eligibility cache missing: fetches=%d checks=%v", calls, checks)
	}
}

func TestPublicProductSearchFailsClosedOnEligibilityOutageAndStalledCursor(t *testing.T) {
	unavailable := errors.New("WLT unavailable")
	fetch := func(_ context.Context, limit int, cursor string) (postgres.PublicCatalogSearchRecord, error) {
		page := postgres.PublicCatalogSearchRecord{Offers: []postgres.CatalogStoreOfferRecord{{ID: "offer-1", StoreID: "store-1"}}}
		next := cursor
		page.NextCursor = &next
		return page, nil
	}
	_, err := collectEligiblePublicCatalogOffers(context.Background(), 1, "cursor", fetch, func(context.Context, string) (bool, error) { return false, unavailable })
	if !errors.Is(err, unavailable) {
		t.Fatalf("an unavailable eligibility authority must not produce empty success: %v", err)
	}
	_, err = collectEligiblePublicCatalogOffers(context.Background(), 1, "cursor", fetch, func(context.Context, string) (bool, error) { return true, nil })
	if err == nil || !strings.Contains(err.Error(), "did not advance") {
		t.Fatalf("a full but stalled search page must fail closed: %v", err)
	}
}

func TestPublicProductSearchRetainsCursorWhenBoundedScanFindsNoEligibleOffers(t *testing.T) {
	fetches := 0
	fetch := func(_ context.Context, limit int, cursor string) (postgres.PublicCatalogSearchRecord, error) {
		fetches++
		page := postgres.PublicCatalogSearchRecord{Offers: []postgres.CatalogStoreOfferRecord{{ID: fmt.Sprintf("offer-%03d", fetches), StoreID: "hidden"}}}
		next := strconv.Itoa(fetches)
		page.NextCursor = &next
		return page, nil
	}
	result, err := collectEligiblePublicCatalogOffers(context.Background(), 1, "", fetch, func(context.Context, string) (bool, error) { return false, nil })
	if err != nil || len(result.Offers) != 0 || result.NextCursor == nil || *result.NextCursor == "" || fetches != 20 {
		t.Fatalf("bounded scan must preserve continuation instead of claiming a final empty page: %+v err=%v fetches=%d", result, err, fetches)
	}
}
