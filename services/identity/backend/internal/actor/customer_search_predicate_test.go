package actor

import (
	"strings"
	"testing"
)

func TestClientSearchPredicateUsesBoundPhoneAndActorID(t *testing.T) {
	predicate := actorRoleSearchPredicate("client", 3)
	if predicate != "(position($3 in a.phone_e164)>0 OR position($3 in a.id)>0)" {
		t.Fatalf("customer search must match a phone or actor ID only, with one bound argument: %s", predicate)
	}
	if strings.Contains(predicate, "full_name_ar") || strings.Contains(predicate, "job_title") {
		t.Fatal("customer search must not copy operator-only profile fields")
	}
}

func TestNonClientSearchPreservesExistingRoleRestrictions(t *testing.T) {
	operator := actorRoleSearchPredicate("operator", 2)
	if !strings.Contains(operator, "identity_operator_profiles") || strings.Contains(operator, "position($2 in a.id)") {
		t.Fatalf("operator search profile scope changed unexpectedly: %s", operator)
	}
	for _, role := range []string{"partner", "captain", "field"} {
		if got := actorRoleSearchPredicate(role, 2); got != "position($2 in a.phone_e164)>0" {
			t.Fatalf("role %s must retain phone-only search, got %s", role, got)
		}
	}
}
