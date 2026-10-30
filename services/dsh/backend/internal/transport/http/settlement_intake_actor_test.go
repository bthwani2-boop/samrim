package transporthttp

import "testing"

func TestRetiredFieldCannotUseIndividualSettlementIntake(t *testing.T) {
	for _, test := range []struct {
		actorType string
		allowed   bool
	}{
		{actorType: "captain", allowed: true},
		{actorType: "field", allowed: false},
		{actorType: "partner", allowed: false},
		{actorType: "customer", allowed: false},
		{actorType: "", allowed: false},
	} {
		t.Run(test.actorType, func(t *testing.T) {
			if got := activeIndividualSettlementActor(test.actorType); got != test.allowed {
				t.Fatalf("activeIndividualSettlementActor(%q) = %t; want %t", test.actorType, got, test.allowed)
			}
		})
	}
}

func TestFieldIntakeConversionPreservesOldReadback(t *testing.T) {
	for _, test := range []struct {
		actorType string
		status    string
		block     bool
	}{
		{actorType: "field", status: "REQUESTED", block: true},
		{actorType: "field", status: "CONVERTED", block: false},
		{actorType: "field", status: "CANCELLED", block: false},
		{actorType: "captain", status: "REQUESTED", block: false},
		{actorType: "partner", status: "REQUESTED", block: false},
	} {
		t.Run(test.actorType+"/"+test.status, func(t *testing.T) {
			if got := retiredFieldIntakeNeedsReview(test.actorType, test.status); got != test.block {
				t.Fatalf("Field review guard(%q,%q)=%t; want %t", test.actorType, test.status, got, test.block)
			}
		})
	}
}
