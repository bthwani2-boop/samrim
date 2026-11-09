package postgres

import (
	"context"
	"errors"
	"testing"
)

func TestIndependentPartnerPickupTransitionGraph(t *testing.T) {
	valid := map[string][]string{
		"SUBMITTED": {"ACCEPTED", "REJECTED"},
		"ACCEPTED":  {"PREPARING"},
		"PREPARING": {"READY"},
		"READY":     {"COMPLETED"},
	}
	states := []string{"SUBMITTED", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "REJECTED", "CANCELLED", "INVALID"}
	for _, from := range states {
		for _, to := range states {
			allowed := false
			for _, v := range valid[from] {
				if v == to {
					allowed = true
				}
			}
			if got := independentPickupTransitionAllowed(from, to); got != allowed {
				t.Errorf("%s -> %s got %v want %v", from, to, got, allowed)
			}
		}
	}
}

func TestIndependentPartnerOrderBadInputsRejectWithoutDB(t *testing.T) {
	for _, tc := range []struct {
		name, store, actor, cursor string
		limit                      int
	}{
		{"empty Store", "", "actor", "", 25},
		{"empty actor", "store-a", "", "", 25},
		{"invalid limit", "store-a", "actor", "", 101},
		{"malformed cursor", "store-a", "actor", "not a valid cursor", 25},
		{"oversized cursor", "store-a", "actor", string(make([]byte, 1025)), 25},
		{"wrong Store cursor", "store-b", "actor", "eyJzdG9yZUlkIjoic3RvcmUtYSIsIm9yZGVySWQiOiJvLTEiLCJhdCI6IjIwMjYtMDEtMDFUMDA6MDA6MDBaIn0", 25},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ListIndependentOrdersForPartner(context.Background(), nil, tc.store, tc.actor, tc.limit, tc.cursor)
			if !errors.Is(err, ErrIndependentPartnerOrderInvalid) {
				t.Fatalf("expected invalid before database, got %v", err)
			}
		})
	}
	for _, tc := range []struct {
		name string
		in   IndependentPartnerOrderTransition
	}{

		{"zero version", IndependentPartnerOrderTransition{State: "ACCEPTED", ExpectedVersion: 0}},
		{"unknown state", IndependentPartnerOrderTransition{State: "UNKNOWN", ExpectedVersion: 1}},
		{"cancel by merchant", IndependentPartnerOrderTransition{State: "CANCELLED", ExpectedVersion: 1}},
		{"submitted is not a transition target", IndependentPartnerOrderTransition{State: "SUBMITTED", ExpectedVersion: 1}},
		{"empty reject reason", IndependentPartnerOrderTransition{State: "REJECTED", ExpectedVersion: 1}},
		{"reason on accepted", IndependentPartnerOrderTransition{State: "ACCEPTED", ExpectedVersion: 1, Reason: "not allowed"}},
		{"multiline reason", IndependentPartnerOrderTransition{State: "REJECTED", ExpectedVersion: 1, Reason: "x\ny"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := TransitionIndependentOrderForPartner(context.Background(), nil, "store-a", "order-a", "actor-a", tc.in)
			if !errors.Is(err, ErrIndependentPartnerOrderInvalid) {
				t.Fatalf("expected invalid before database, got %v", err)
			}
		})
	}
}
