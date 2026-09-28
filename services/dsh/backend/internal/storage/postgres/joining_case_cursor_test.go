package postgres

import (
	"strings"
	"testing"
	"time"
)

func TestJoiningCaseCursorBindsAudienceAndFilters(t *testing.T) {
	createdAt := time.Date(2026, time.September, 26, 12, 0, 0, 123000000, time.UTC)
	fieldCursor, err := encodeJoiningCaseCursor(joiningCaseCursor{
		Version:      1,
		Scope:        "field",
		CreatedAt:    createdAt,
		ID:           "case-1",
		Sort:         "created_desc",
		Query:        "قهوة",
		FieldActorID: "field-1",
	})
	if err != nil {
		t.Fatalf("encode Field cursor: %v", err)
	}
	if len(fieldCursor) > 2048 {
		t.Fatalf("Field cursor exceeds the OpenAPI limit: %d", len(fieldCursor))
	}
	decoded, err := decodeJoiningCaseCursor(fieldCursor, "field", "", "قهوة", "created_desc", "field-1")
	if err != nil || decoded == nil || decoded.ID != "case-1" || !decoded.CreatedAt.Equal(createdAt) {
		t.Fatalf("decode Field cursor: %#v err=%v", decoded, err)
	}
	for _, scope := range []struct {
		name, audience, state, query, sort, fieldActorID string
	}{
		{"other Field actor", "field", "", "قهوة", "created_desc", "field-2"},
		{"other search", "field", "", "متجر", "created_desc", "field-1"},
		{"other sort", "field", "", "قهوة", "created_asc", "field-1"},
		{"operator audience", "operator", "", "قهوة", "created_desc", ""},
	} {
		if _, err := decodeJoiningCaseCursor(fieldCursor, scope.audience, scope.state, scope.query, scope.sort, scope.fieldActorID); err == nil {
			t.Errorf("Field cursor should reject %s", scope.name)
		}
	}

	operatorCursor, err := encodeJoiningCaseCursor(joiningCaseCursor{
		Version:   1,
		Scope:     "operator",
		CreatedAt: createdAt,
		ID:        "case-2",
		Sort:      "created_asc",
		State:     "submitted",
		Query:     "متجر",
	})
	if err != nil {
		t.Fatalf("encode operator cursor: %v", err)
	}
	if _, err := decodeJoiningCaseCursor(operatorCursor, "operator", "submitted", "متجر", "created_asc", ""); err != nil {
		t.Fatalf("decode operator cursor: %v", err)
	}
	for _, scope := range []struct{ state, query, sort string }{
		{"approved", "متجر", "created_asc"},
		{"submitted", "طلب", "created_asc"},
		{"submitted", "متجر", "created_desc"},
	} {
		if _, err := decodeJoiningCaseCursor(operatorCursor, "operator", scope.state, scope.query, scope.sort, ""); err == nil {
			t.Errorf("operator cursor should reject changed filters: %#v", scope)
		}
	}
}

func TestJoiningCaseCursorRejectsMalformedAndLegacyTokens(t *testing.T) {
	for _, malformed := range []string{"!", "e30", strings.Repeat("a", 2049)} {
		if _, err := decodeJoiningCaseCursor(malformed, "field", "", "", "created_desc", "field-1"); err == nil {
			t.Errorf("malformed joining-case cursor %q must be rejected", malformed)
		}
	}
	legacy, err := encodeJoiningCaseCursor(joiningCaseCursor{CreatedAt: time.Now().UTC(), ID: "case-legacy", Sort: "created_asc"})
	if err != nil {
		t.Fatalf("encode legacy cursor: %v", err)
	}
	if _, err := decodeJoiningCaseCursor(legacy, "operator", "", "", "created_asc", ""); err == nil {
		t.Fatal("unversioned legacy cursor must be rejected after the canonical cursor cutover")
	}
}

func TestNormalizeJoiningCaseSearchUsesUnicodeLengthAndRejectsUnstorableText(t *testing.T) {
	query := strings.Repeat("ق", 128)
	normalized, err := normalizeJoiningCaseSearch(query)
	if err != nil || normalized != query {
		t.Fatalf("normalize 128 Arabic characters: %q err=%v", normalized, err)
	}
	if _, err := normalizeJoiningCaseSearch(strings.Repeat("x", 129)); err == nil {
		t.Fatal("search longer than 128 Unicode characters must be rejected")
	}
	for _, invalid := range []string{"\x00", string([]byte{0xff})} {
		if _, err := normalizeJoiningCaseSearch(invalid); err == nil {
			t.Errorf("search containing an invalid PostgreSQL text value must be rejected: %q", invalid)
		}
	}

	maxUnicodeCursor, err := encodeJoiningCaseCursor(joiningCaseCursor{
		Version: 1, Scope: "operator", CreatedAt: time.Date(2026, time.September, 26, 12, 0, 0, 0, time.UTC),
		ID: "case-max-query", Sort: "created_asc", Query: strings.Repeat("😀", 128),
	})
	if err != nil {
		t.Fatalf("encode maximum Unicode operator cursor: %v", err)
	}
	if len(maxUnicodeCursor) > 2048 {
		t.Fatalf("maximum Unicode operator cursor exceeds its contract limit: %d", len(maxUnicodeCursor))
	}
}
