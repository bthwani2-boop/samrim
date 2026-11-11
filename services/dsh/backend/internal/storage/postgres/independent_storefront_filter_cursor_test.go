package postgres

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestIndependentPublicCatalogSQLBindsFiltersAndCursor(t *testing.T) {
	for _, fragment := range []string{
		"WHERE o.store_id=$1",
		"pc.category_id=$2",
		"p.id=$3",
		"strpos(lower(p.canonical_name),lower($4))",
		"strpos(lower(v.title),lower($4))",
		"$5::timestamptz IS NULL",
		"$6::text",
		"LIMIT $7",
	} {
		if !strings.Contains(independentWebOffersPageSQL, fragment) {
			t.Errorf("independent public query lost its bound filter: %s", fragment)
		}
	}
	if !strings.Contains(independentWebOffersPageSQL, independentWebOfferPresentationSQL) ||
		!strings.Contains(independentWebCategorySQL, independentWebOfferPresentationSQL) {
		t.Fatal("public pagination and categories must share the canonical publishable Offer gate")
	}
}

func TestIndependentCatalogCursorCannotCrossStoreCityTermsOrFilters(t *testing.T) {
	const store = "store-a"
	scope := independentCatalogCursorScope(store, "legal-v1", "sanaa", "cat-a", "product-a", "coffee")
	token, err := encodeCatalogStoreOfferCursor(catalogStoreOfferCursor{
		Version: 1, StoreID: scope,
		CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		OfferID:   "offer-a",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeCatalogStoreOfferCursor(token, scope); err != nil {
		t.Fatalf("same scope cursor rejected: %v", err)
	}
	for _, tc := range []struct {
		name, store, terms, city, category, product, search string
	}{
		{"store", "store-b", "legal-v1", "sanaa", "cat-a", "product-a", "coffee"},
		{"terms", store, "legal-v2", "sanaa", "cat-a", "product-a", "coffee"},
		{"city", store, "legal-v1", "aden", "cat-a", "product-a", "coffee"},
		{"category", store, "legal-v1", "sanaa", "cat-b", "product-a", "coffee"},
		{"product", store, "legal-v1", "sanaa", "cat-a", "product-b", "coffee"},
		{"search", store, "legal-v1", "sanaa", "cat-a", "product-a", "tea"},
		{"unfiltered", store, "legal-v1", "", "", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			other := independentCatalogCursorScope(tc.store, tc.terms, tc.city, tc.category, tc.product, tc.search)
			if _, err := decodeCatalogStoreOfferCursor(token, other); !errors.Is(err, ErrCatalogOfferInvalidCursor) {
				t.Fatalf("cross-scope cursor accepted, err=%v", err)
			}
		})
	}
}
