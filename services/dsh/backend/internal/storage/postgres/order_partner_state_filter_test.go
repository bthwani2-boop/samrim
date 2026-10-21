package postgres

import (
	"errors"
	"testing"
)

func TestCanonicalOrderStatesAcceptSevenActivePartnerStates(t *testing.T) {
	active := []string{"CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED", "IN_CUSTODY"}
	states, err := canonicalOrderStates(active)
	if err != nil || len(states) != len(active) {
		t.Fatalf("expected seven accepted states: count=%d err=%v", len(states), err)
	}
}

func TestCanonicalOrderStatesRejectTooManyAndInvalidStates(t *testing.T) {
	for _, states := range [][]string{
		{"CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED", "IN_CUSTODY", "DELIVERED"},
		{"CREATED", "INVALID_STATE"},
	} {
		if _, err := canonicalOrderStates(states); !errors.Is(err, ErrPartnerOrdersInvalidState) {
			t.Errorf("invalid state filters must be rejected: states=%v err=%v", states, err)
		}
	}
}
