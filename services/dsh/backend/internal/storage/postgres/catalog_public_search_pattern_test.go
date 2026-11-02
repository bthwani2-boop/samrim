package postgres

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCustomerCatalogSearchEscapesSubstringTerms(t *testing.T) {
	cases := []struct {
		query    string
		expected string
	}{
		{"USB", "%USB%"},
		{"  USB-C  ", "%USB-C%"},
		{"شاحن", "%شاحن%"},
		{"a%b", "%a!%b%"},
		{"x_y", "%x!_y%"},
		{"ab!cd", "%ab!!cd%"},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			if got := escapeCatalogSearchContains(tc.query); got != tc.expected {
				t.Fatalf("search pattern=%q, want=%q", got, tc.expected)
			}
		})
	}
}

func TestCustomerCatalogShortSearchRemainsPrefixOnly(t *testing.T) {
	for _, term := range []string{"a", "ab", "ش", "شا"} {
		if utf8.RuneCountInString(term) >= 3 {
			t.Fatalf("invalid short-search test fixture %q", term)
		}
		pattern := escapeCatalogSearchPrefix(term)
		if strings.HasPrefix(pattern, "%") || !strings.HasSuffix(pattern, "%") {
			t.Fatalf("short query must stay prefix-scoped: %q", pattern)
		}
	}
}

func TestCustomerCatalogCursorRejectsDifferentSearchTerm(t *testing.T) {
	cursor := encodeCatalogSearchCursor("شاحن USB-C", "offer-a", "", "sanaa", "grocery", "", "USB", "", "", "")
	same, err := decodeCatalogSearchCursor(cursor, "", "sanaa", "grocery", "", "USB", "", "", "")
	if err != nil || same.offerID != "offer-a" {
		t.Fatalf("valid cursor failed: %+v %v", same, err)
	}
	if _, err := decodeCatalogSearchCursor(cursor, "", "sanaa", "grocery", "", "HDMI", "", "", ""); err == nil {
		t.Fatal("cursor must be bound to the exact query")
	}
	if _, err := decodeCatalogSearchCursor(cursor, "", "aden", "grocery", "", "USB", "", "", ""); err == nil {
		t.Fatal("cursor must reject a different service city")
	}
}

func TestCustomerCatalogInfixSearchMigrationRegistered(t *testing.T) {
	records, sqls, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != SchemaVersion || len(sqls) != SchemaVersion || records[169].Version != 170 ||
		records[169].Name != "170_customer_catalog_name_infix_search.sql" {
		t.Fatalf("unexpected customer catalog search migration graph: count=%d", len(records))
	}
	if !strings.Contains(sqls[169], "USING gin (lower(canonical_name) gin_trgm_ops)") {
		t.Fatal("migration must include the canonical-name trigram expression index")
	}
}

func TestCustomerCatalogPriceCursorBindsSortCityAndQuery(t *testing.T) {
	cursor := encodeCatalogSearchCursor("2100", "offer-b", "", "sanaa", "grocery", "", "USB", "", "", "shortcut", "PRICE_ASC")
	position, err := decodeCatalogSearchCursor(cursor, "", "sanaa", "grocery", "", "USB", "", "", "shortcut", "PRICE_ASC")
	if err != nil || position.canonicalName != "2100" || position.offerID != "offer-b" {
		t.Fatalf("valid ascending price cursor failed: %+v %v", position, err)
	}
	for _, tc := range []struct{ city, query, shortcut, sort string }{
		{"sanaa", "USB", "shortcut", "PRICE_DESC"},
		{"sanaa", "USB", "shortcut", ""},
		{"sanaa", "HDMI", "shortcut", "PRICE_ASC"},
		{"aden", "USB", "shortcut", "PRICE_ASC"},
		{"sanaa", "USB", "other-shortcut", "PRICE_ASC"},
	} {
		if _, err := decodeCatalogSearchCursor(cursor, "", tc.city, "grocery", "", tc.query, "", "", tc.shortcut, tc.sort); err == nil {
			t.Fatalf("cursor must reject changed city/query/shortcut/sort: %+v", tc)
		}
	}
}
