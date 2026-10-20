package postgres

import (
	"errors"
	"testing"
)

func TestCatalogProductUpdateIdentityPreservesOwner(t *testing.T) {
	shared := CatalogProductRecord{VerticalID: "grocery", Scope: "SHARED"}
	local := CatalogProductRecord{VerticalID: "grocery", Scope: "STORE_SCOPED", StoreID: "store-a"}

	cases := []struct {
		name    string
		current CatalogProductRecord
		update  CatalogProductUpdateInput
		deny    bool
	}{
		{"shared metadata edit", shared, CatalogProductUpdateInput{VerticalID: "grocery", Scope: "SHARED"}, false},
		{"local metadata edit", local, CatalogProductUpdateInput{VerticalID: "grocery", Scope: "STORE_SCOPED", StoreID: "store-a"}, false},
		{"shared converted to local", shared, CatalogProductUpdateInput{VerticalID: "grocery", Scope: "STORE_SCOPED", StoreID: "store-a"}, true},
		{"local converted to shared", local, CatalogProductUpdateInput{VerticalID: "grocery", Scope: "SHARED"}, true},
		{"local moved to another store", local, CatalogProductUpdateInput{VerticalID: "grocery", Scope: "STORE_SCOPED", StoreID: "store-b"}, true},
		{"local stripped of its store", local, CatalogProductUpdateInput{VerticalID: "grocery", Scope: "STORE_SCOPED"}, true},
		{"shared moved to another vertical", shared, CatalogProductUpdateInput{VerticalID: "pharmacy", Scope: "SHARED"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateCatalogProductUpdateIdentity(tc.current, tc.update)
			if tc.deny {
				if !errors.Is(err, ErrCatalogProductScopeMismatch) {
					t.Fatalf("expected scope mismatch; got %v", err)
				}
			} else if err != nil {
				t.Fatalf("unchanged identity must remain editable: %v", err)
			}
		})
	}
}
