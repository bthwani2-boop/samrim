package postgres

import (
	"errors"
	"testing"
	"time"
)

func TestQuickPriceFilterCursorBindsStoreAndInventorySelection(t *testing.T) {
	base := CatalogQuickPriceFilters{Query: "شاحن", Availability: "all", PublicationState: "all", InventoryStatus: "all"}
	stockout := base
	stockout.InventoryStatus = "stockout"
	if quickPriceFilterHash(base) == quickPriceFilterHash(stockout) {
		t.Fatal("changing inventory filter must change cursor scope")
	}
	at := time.Date(2026, 10, 31, 7, 0, 0, 0, time.UTC)
	raw, err := encodeQuickPriceCursor(catalogQuickPriceCursor{
		Version: 2, StoreID: "store-a", FilterHash: quickPriceFilterHash(stockout), CreatedAt: at, OfferID: "offer-10",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeQuickPriceCursor(raw, "store-a", quickPriceFilterHash(stockout)); err != nil {
		t.Fatalf("same store and status should accept page cursor: %v", err)
	}
	if _, err := decodeQuickPriceCursor(raw, "store-b", quickPriceFilterHash(stockout)); !errors.Is(err, ErrCatalogOfferInvalidCursor) {
		t.Fatalf("foreign store must be rejected: %v", err)
	}
	if _, err := decodeQuickPriceCursor(raw, "store-a", quickPriceFilterHash(base)); !errors.Is(err, ErrCatalogOfferInvalidCursor) {
		t.Fatalf("changed filter must be rejected: %v", err)
	}
}

func TestQuickPriceFilterDefaultRemainsCompatibleWithExistingCursors(t *testing.T) {
	f := CatalogQuickPriceFilters{Query: "item", CategoryID: "category", Availability: "available", PublicationState: "published"}
	legacy := hashFacts("catalog-quick-price-filter", f.Query, f.CategoryID, f.Availability, f.PublicationState)
	if got := quickPriceFilterHash(f); got != legacy {
		t.Fatal("default inventory selection must preserve existing cursor hash")
	}
	f.InventoryStatus = "all"
	if got := quickPriceFilterHash(f); got != legacy {
		t.Fatal("explicit all selection must not invalidate existing cursors")
	}
}
