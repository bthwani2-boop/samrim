package postgres

import (
	"strings"
	"testing"
)

func TestPublicPromotionsListingKeepsCanonicalColumns(t *testing.T) {
	if !strings.Contains(listPublicPromotionsQuery, promotionSelect) {
		t.Fatal("public promotion listing query drifted from the canonical promotion column list")
	}
}
