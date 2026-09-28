package postgres

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestCatalogCategoryCursorBindsRegistryScope(t *testing.T) {
	query := "قهوة عربية"
	cursor := catalogCategoryCursor{Version: 1, VerticalID: "food", Query: query, Status: "active", Sort: "name_asc", NameKey: "قهوة عربية", CategoryID: "category-1"}
	raw, err := encodeCatalogCategoryCursor(cursor)
	if err != nil {
		t.Fatalf("encode category cursor: %v", err)
	}
	if len(raw) > 2048 {
		t.Fatalf("category cursor exceeds the OpenAPI limit: %d", len(raw))
	}
	if _, err := decodeCatalogCategoryCursor(raw, "food", query, "active", "name_asc"); err != nil {
		t.Fatalf("decode category cursor for its original query: %v", err)
	}
	for _, scope := range []struct{ verticalID, query, status, sort string }{
		{"retail", query, "active", "name_asc"},
		{"food", "شاي", "active", "name_asc"},
		{"food", query, "inactive", "name_asc"},
		{"food", query, "active", "name_desc"},
	} {
		if _, err := decodeCatalogCategoryCursor(raw, scope.verticalID, scope.query, scope.status, scope.sort); err == nil {
			t.Fatalf("category cursor should reject changed scope: %#v", scope)
		}
	}
	updated := catalogCategoryCursor{Version: 1, VerticalID: "food", Query: query, Status: "all", Sort: "updated_desc", UpdatedAt: time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC), CategoryID: "category-2"}
	updatedRaw, err := encodeCatalogCategoryCursor(updated)
	if err != nil {
		t.Fatalf("encode updated category cursor: %v", err)
	}
	if _, err := decodeCatalogCategoryCursor(updatedRaw, "food", query, "all", "updated_desc"); err != nil {
		t.Fatalf("decode updated category cursor: %v", err)
	}
	if _, err := decodeCatalogCategoryCursor("!", "food", query, "all", "updated_desc"); err == nil {
		t.Fatal("malformed category cursor must be rejected")
	}
}

func TestCatalogStoreOfferCursorBindsStoreAndRejectsMalformedTokens(t *testing.T) {
	createdAt := time.Date(2026, 9, 26, 12, 0, 0, 123000000, time.UTC)
	cursor := catalogStoreOfferCursor{Version: 1, StoreID: "store-1", CreatedAt: createdAt, OfferID: "offer-1"}
	raw, err := encodeCatalogStoreOfferCursor(cursor)
	if err != nil {
		t.Fatalf("encode StoreOffer cursor: %v", err)
	}
	if len(raw) > 2048 {
		t.Fatalf("StoreOffer cursor exceeds the OpenAPI limit: %d", len(raw))
	}
	position, err := decodeCatalogStoreOfferCursor(raw, "store-1")
	if err != nil || !position.CreatedAt.Equal(createdAt) || position.OfferID != "offer-1" {
		t.Fatalf("decode StoreOffer cursor: %#v err=%v", position, err)
	}
	if _, err := decodeCatalogStoreOfferCursor(raw, "store-2"); err == nil {
		t.Fatal("StoreOffer cursor from another Store must be rejected")
	}
	for _, malformed := range []string{"!", "e30"} {
		if _, err := decodeCatalogStoreOfferCursor(malformed, "store-1"); err == nil {
			t.Fatalf("malformed StoreOffer cursor %q must be rejected", malformed)
		}
	}
}

func TestCatalogSearchCursorRoundTripsAndBindsSearchScope(t *testing.T) {
	storeID := ""
	serviceCityID := "city-1"
	categoryID := "category-1"
	query := "قهوة"
	productID := "product-1"
	cursor := encodeCatalogSearchCursor("قهوة عربية", "offer-1", storeID, serviceCityID, categoryID, query, productID, "")

	position, err := decodeCatalogSearchCursor(cursor, storeID, serviceCityID, categoryID, query, productID, "")
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	if position.canonicalName != "قهوة عربية" || position.offerID != "offer-1" {
		t.Fatalf("unexpected cursor position: %#v", position)
	}

	tests := []struct {
		name          string
		storeID       string
		serviceCityID string
		categoryID    string
		query         string
		productID     string
	}{
		{name: "store", storeID: "store-1", serviceCityID: serviceCityID, categoryID: categoryID, query: query, productID: productID},
		{name: "city", serviceCityID: "city-2", categoryID: categoryID, query: query},
		{name: "category", serviceCityID: serviceCityID, categoryID: "category-2", query: query},
		{name: "query", serviceCityID: serviceCityID, categoryID: categoryID, query: "شاي", productID: productID},
		{name: "product", serviceCityID: serviceCityID, categoryID: categoryID, query: query, productID: "product-2"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := decodeCatalogSearchCursor(cursor, test.storeID, test.serviceCityID, test.categoryID, test.query, test.productID, ""); err == nil {
				t.Fatal("expected a cursor from another search scope to be rejected")
			}
		})
	}
}

func TestCatalogSearchCursorSupportsMaximumLengthUnicodeName(t *testing.T) {
	name := strings.Repeat("𐐷", 160)
	cursor := encodeCatalogSearchCursor(name, "550e8400-e29b-41d4-a716-446655440000", "", "550e8400-e29b-41d4-a716-446655440001", "", strings.Repeat("ع", 160), "product-1", "")
	if len(cursor) > 1024 {
		t.Fatalf("cursor exceeds the OpenAPI limit: %d", len(cursor))
	}
	position, err := decodeCatalogSearchCursor(cursor, "", "550e8400-e29b-41d4-a716-446655440001", "", strings.Repeat("ع", 160), "product-1", "")
	if err != nil {
		t.Fatalf("decode maximum-length Unicode cursor: %v", err)
	}
	if position.canonicalName != name {
		t.Fatal("cursor changed the Unicode pagination key")
	}
}

func TestCatalogSearchCursorBindsFavoriteViewToClient(t *testing.T) {
	storeID, serviceCityID, clientActorID := "store-1", "city-1", "client-1"
	cursor := encodeCatalogSearchCursor("منتج", "offer-1", storeID, serviceCityID, "", "", "", clientActorID)
	if _, err := decodeCatalogSearchCursor(cursor, storeID, serviceCityID, "", "", "", clientActorID); err != nil {
		t.Fatalf("decode cursor for original client: %v", err)
	}
	if _, err := decodeCatalogSearchCursor(cursor, storeID, serviceCityID, "", "", "", "client-2"); err == nil {
		t.Fatal("expected a favorite-view cursor from another client to be rejected")
	}
}

func TestCatalogSearchCursorRejectsMalformedTokens(t *testing.T) {
	validScope := []string{"", "city-1", "", "قهوة"}
	for _, cursor := range []string{"!", base64.RawURLEncoding.EncodeToString([]byte("name\x00offer")), base64.RawURLEncoding.EncodeToString([]byte("\x00offer\x00" + strings.Repeat("x", 16)))} {
		if _, err := decodeCatalogSearchCursor(cursor, validScope[0], validScope[1], validScope[2], validScope[3], "", ""); err == nil {
			t.Fatalf("expected malformed cursor %q to be rejected", cursor)
		}
	}
}

func TestEscapeCatalogSearchPrefixTreatsWildcardsLiterally(t *testing.T) {
	if got, want := escapeCatalogSearchPrefix("!_%"), "!!!_!%%"; got != want {
		t.Fatalf("escapeCatalogSearchPrefix() = %q, want %q", got, want)
	}
}
