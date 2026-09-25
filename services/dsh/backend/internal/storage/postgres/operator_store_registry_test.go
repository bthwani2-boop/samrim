package postgres

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestOperatorStoreCursorBindsRegistryScopeWithinContractLimit(t *testing.T) {
	state := "published"
	query := strings.Repeat("𐐷", 128)
	cityID := strings.Repeat("c", 128)
	searchMode := "name_prefix"
	sort := "name_asc"
	cursor := encodeOperatorStoreCursor(operatorStoreCursor{ID: strings.Repeat("i", 128)}, state, query, cityID, searchMode, sort)
	if len(cursor) > 1024 {
		t.Fatalf("operator store cursor exceeds the OpenAPI limit: %d", len(cursor))
	}

	decoded, err := decodeOperatorStoreCursor(cursor, state, query, cityID, searchMode, sort)
	if err != nil {
		t.Fatalf("decode cursor: %v", err)
	}
	if decoded.ID != strings.Repeat("i", 128) {
		t.Fatalf("decoded cursor ID = %q", decoded.ID)
	}

	if _, err := decodeOperatorStoreCursor(cursor, state, query, "another-city", searchMode, sort); err == nil {
		t.Fatal("expected a cursor from another city to be rejected")
	}
	if _, err := decodeOperatorStoreCursor(cursor, state, query, cityID, "contains", "updated_desc"); err == nil {
		t.Fatal("expected a cursor from another search mode and sort to be rejected")
	}
}

func TestOperatorStoreCursorSupportsLegacyContainsPages(t *testing.T) {
	legacy := operatorStoreCursor{
		UpdatedAt: time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC),
		ID:        "store-1",
		State:     "published",
		Query:     "قهوة",
		Sort:      "updated_desc",
	}
	value, err := json.Marshal(legacy)
	if err != nil {
		t.Fatalf("marshal legacy cursor: %v", err)
	}
	raw := base64.RawURLEncoding.EncodeToString(value)

	decoded, err := decodeOperatorStoreCursor(raw, "published", "قهوة", "", "contains", "updated_desc")
	if err != nil {
		t.Fatalf("decode legacy contains cursor: %v", err)
	}
	if decoded.ID != legacy.ID || !decoded.UpdatedAt.Equal(legacy.UpdatedAt) {
		t.Fatalf("legacy cursor position changed: %#v", decoded)
	}
	if _, err := decodeOperatorStoreCursor(raw, "published", "قهوة", "city-1", "contains", "updated_desc"); err == nil {
		t.Fatal("expected a legacy cursor to reject a city-scoped search")
	}
}

func TestEscapeOperatorStoreSearchTreatsWildcardsLiterally(t *testing.T) {
	if got, want := escapeOperatorStoreSearch("!_%"), "!!!_!%"; got != want {
		t.Fatalf("escapeOperatorStoreSearch() = %q, want %q", got, want)
	}
}
