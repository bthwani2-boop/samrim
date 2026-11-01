package postgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
)

func TestCatalogActivityCursorBindsStoreAndFilters(t *testing.T) {
	base := CatalogActivityFilter{StoreID: "store-one", Query: "bread", Kind: "offer", Action: "updated", From: "2026-10-01T00:00:00Z", To: "2026-11-01T00:00:00Z", Limit: 10}
	cursor := catalogActivityCursor{V: 1, At: "2026-10-20T10:20:30Z", Kind: "offer", ID: 15, StoreID: base.StoreID, Query: base.Query, FilterKind: base.Kind, Action: base.Action, From: base.From, To: base.To}
	raw, err := json.Marshal(cursor)
	if err != nil {
		t.Fatal(err)
	}
	base.Cursor = base64.RawURLEncoding.EncodeToString(raw)
	if _, err := decodeCatalogActivityCursor(base); err != nil {
		t.Fatalf("valid cursor rejected: %v", err)
	}
	for name, mutate := range map[string]func(*CatalogActivityFilter){
		"another-store":    func(f *CatalogActivityFilter) { f.StoreID = "store-two" },
		"different-query":  func(f *CatalogActivityFilter) { f.Query = "rice" },
		"different-kind":   func(f *CatalogActivityFilter) { f.Kind = "product" },
		"different-action": func(f *CatalogActivityFilter) { f.Action = "created" },
		"different-range":  func(f *CatalogActivityFilter) { f.To = "2026-12-01T00:00:00Z" },
	} {
		t.Run(name, func(t *testing.T) {
			changed := base
			mutate(&changed)
			if _, err := decodeCatalogActivityCursor(changed); !errors.Is(err, ErrCatalogActivityFilter) {
				t.Fatalf("cursor accepted cross-scope filter change: %v", err)
			}
		})
	}
}

func TestCatalogActivityRejectsInvalidInputsBeforeQuery(t *testing.T) {
	cases := []CatalogActivityFilter{
		{Limit: 0}, {Limit: 51}, {Limit: 20, Kind: "staff"}, {Limit: 20, Action: "delete"},
		{Limit: 20, From: "2026-13-01T00:00:00Z"},
		{Limit: 20, From: "2026-11-02T00:00:00Z", To: "2026-11-01T00:00:00Z"},
		{Limit: 20, Cursor: "n0t-base64"},
	}
	for i, filter := range cases {
		if _, err := ListCatalogActivity(context.Background(), nil, filter); !errors.Is(err, ErrCatalogActivityFilter) {
			t.Errorf("case %d accepted invalid filter: %v", i, err)
		}
	}
}
