package postgres

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestCatalogSearchCursorRoundTripsAndBindsSearchScope(t *testing.T) {
	storeID := ""
	serviceCityID := "city-1"
	categoryID := "category-1"
	query := "قهوة"
	cursor := encodeCatalogSearchCursor("قهوة عربية", "offer-1", storeID, serviceCityID, categoryID, query)

	position, err := decodeCatalogSearchCursor(cursor, storeID, serviceCityID, categoryID, query)
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
	}{
		{name: "store", storeID: "store-1", serviceCityID: serviceCityID, categoryID: categoryID, query: query},
		{name: "city", serviceCityID: "city-2", categoryID: categoryID, query: query},
		{name: "category", serviceCityID: serviceCityID, categoryID: "category-2", query: query},
		{name: "query", serviceCityID: serviceCityID, categoryID: categoryID, query: "شاي"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := decodeCatalogSearchCursor(cursor, test.storeID, test.serviceCityID, test.categoryID, test.query); err == nil {
				t.Fatal("expected a cursor from another search scope to be rejected")
			}
		})
	}
}

func TestCatalogSearchCursorSupportsMaximumLengthUnicodeName(t *testing.T) {
	name := strings.Repeat("𐐷", 160)
	cursor := encodeCatalogSearchCursor(name, "550e8400-e29b-41d4-a716-446655440000", "", "550e8400-e29b-41d4-a716-446655440001", "", strings.Repeat("ع", 160))
	if len(cursor) > 1024 {
		t.Fatalf("cursor exceeds the OpenAPI limit: %d", len(cursor))
	}
	position, err := decodeCatalogSearchCursor(cursor, "", "550e8400-e29b-41d4-a716-446655440001", "", strings.Repeat("ع", 160))
	if err != nil {
		t.Fatalf("decode maximum-length Unicode cursor: %v", err)
	}
	if position.canonicalName != name {
		t.Fatal("cursor changed the Unicode pagination key")
	}
}

func TestCatalogSearchCursorRejectsMalformedTokens(t *testing.T) {
	validScope := []string{"", "city-1", "", "قهوة"}
	for _, cursor := range []string{"!", base64.RawURLEncoding.EncodeToString([]byte("name\x00offer")), base64.RawURLEncoding.EncodeToString([]byte("\x00offer\x00" + strings.Repeat("x", 16)))} {
		if _, err := decodeCatalogSearchCursor(cursor, validScope[0], validScope[1], validScope[2], validScope[3]); err == nil {
			t.Fatalf("expected malformed cursor %q to be rejected", cursor)
		}
	}
}

func TestEscapeCatalogSearchPrefixTreatsWildcardsLiterally(t *testing.T) {
	if got, want := escapeCatalogSearchPrefix("!_%"), "!!!_!%%"; got != want {
		t.Fatalf("escapeCatalogSearchPrefix() = %q, want %q", got, want)
	}
}
