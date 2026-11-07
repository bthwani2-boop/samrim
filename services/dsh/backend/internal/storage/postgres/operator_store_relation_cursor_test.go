package postgres

import (
	"errors"
	"testing"
	"time"
)

func TestOperatorStoreCursorScopedToCanonicalRelation(t *testing.T) {
	anchor := operatorStoreCursor{ID: "store-cursor-1", UpdatedAt: time.Now().UTC()}
	independent := encodeOperatorStoreCursor(anchor, "", "bakery", "", "contains", "updated_desc", StoreRelationIndependent)
	if _, err := decodeOperatorStoreCursor(independent, "", "bakery", "", "contains", "updated_desc", StoreRelationIndependent); err != nil {
		t.Fatalf("matching independent Store cursor rejected: %v", err)
	}
	for _, relation := range []string{"", StoreRelationBThwaniPartner} {
		if _, err := decodeOperatorStoreCursor(independent, "", "bakery", "", "contains", "updated_desc", relation); !errors.Is(err, ErrOperatorStoreInvalidCursor) {
			t.Fatalf("independent page token leaked to relation %q: %v", relation, err)
		}
	}
	defaultCursor := encodeOperatorStoreCursor(anchor, "", "bakery", "", "contains", "updated_desc", "")
	if _, err := decodeOperatorStoreCursor(defaultCursor, "", "bakery", "", "contains", "updated_desc", ""); err != nil {
		t.Fatalf("existing unfiltered cursor must remain usable: %v", err)
	}
	if _, err := decodeOperatorStoreCursor(defaultCursor, "", "bakery", "", "contains", "updated_desc", StoreRelationIndependent); !errors.Is(err, ErrOperatorStoreInvalidCursor) {
		t.Fatalf("unfiltered cursor may not select an independent-only page: %v", err)
	}
}
