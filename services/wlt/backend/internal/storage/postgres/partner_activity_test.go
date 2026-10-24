package postgres

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestPartnerActivityScopeAndFilterValidation(t *testing.T) {
	db := &sql.DB{}
	owner := "partner-a"
	cases := []struct {
		name  string
		owner string
		query PartnerActivityQuery
	}{
		{"no Stores", owner, PartnerActivityQuery{Limit: 25}},
		{"other Store missing id", owner, PartnerActivityQuery{StoreIDs: []string{""}, Limit: 25}},
		{"invalid kind", owner, PartnerActivityQuery{StoreIDs: []string{"store-a"}, Limit: 25, Kind: "UNVERIFIED"}},
		{"unbounded limit", owner, PartnerActivityQuery{StoreIDs: []string{"store-a"}, Limit: 101}},
		{"cursor must be complete", owner, PartnerActivityQuery{StoreIDs: []string{"store-a"}, Limit: 25, CursorKind: "ORDER", CursorID: "id"}},
		{"invalid date range", owner, PartnerActivityQuery{StoreIDs: []string{"store-a"}, Limit: 25, From: time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC), To: time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)}},
		{"search length", owner, PartnerActivityQuery{StoreIDs: []string{"store-a"}, Limit: 25, Search: strings.Repeat("x", 129)}},
		{"unknown payment method", owner, PartnerActivityQuery{StoreIDs: []string{"store-a"}, Limit: 25, PaymentMethod: "CREDIT_CARD"}},
		{"no partner actor", "", PartnerActivityQuery{StoreIDs: []string{"store-a"}, Limit: 25}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ListPartnerActivity(t.Context(), db, tc.owner, tc.query)
			if !errors.Is(err, ErrPartnerActivityInput) {
				t.Fatalf("expected invalid scope/filter; got %v", err)
			}
		})
	}
}
