package postgres

import (
	"reflect"
	"testing"
)

func TestCanonicalStorePermissionsAreFiniteAndDeterministic(t *testing.T) {
	got := canonicalStorePermissions([]string{" store_operations ", "orders", "catalog", "orders", ""})
	want := []string{"catalog", "orders", "store_operations"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("canonical permissions = %#v, want %#v", got, want)
	}
	for _, permission := range want {
		if !validStorePermission(permission) {
			t.Fatalf("canonical permission rejected: %s", permission)
		}
	}
	for _, forbidden := range []string{"finance", "owner", "operators", "*", ""} {
		if validStorePermission(forbidden) {
			t.Fatalf("unexpected Store permission admitted: %q", forbidden)
		}
	}
}

func TestStoreAccessHashesCanonicalizeEquivalentFacts(t *testing.T) {
	first := HashStoreAccessInvitationCreate(" store-1 ", " owner-1 ", " delegate-1 ", []string{"orders", "catalog", "orders"})
	second := HashStoreAccessInvitationCreate("store-1", "owner-1", "delegate-1", []string{" catalog ", "orders"})
	if first != second {
		t.Fatal("equivalent Store access invitation facts must hash identically")
	}
	if first == HashStoreAccessInvitationCreate("store-1", "owner-1", "delegate-2", []string{"catalog", "orders"}) {
		t.Fatal("different delegate actor must change Store access invitation hash")
	}
}

func TestStoreAccessTransitionHashesBindExpectedVersionAndActor(t *testing.T) {
	base := HashStoreAccessTransition("store-1", "grant-1", "owner-1", "revoked", 4)
	cases := []string{
		HashStoreAccessTransition("store-1", "grant-1", "owner-2", "revoked", 4),
		HashStoreAccessTransition("store-1", "grant-1", "owner-1", "revoked", 5),
		HashStoreAccessTransition("store-1", "grant-1", "owner-1", "suspended", 4),
	}
	for _, candidate := range cases {
		if candidate == base {
			t.Fatal("Store access transition hash failed to bind a material mutation fact")
		}
	}
}

func TestStoreAccessDecisionHashesBindDelegateAndDecision(t *testing.T) {
	accept := HashStoreAccessInvitationDecision("grant-1", "delegate-1", "accept", 2)
	if accept == HashStoreAccessInvitationDecision("grant-1", "delegate-2", "accept", 2) {
		t.Fatal("Store access decision hash must bind delegate actor")
	}
	if accept == HashStoreAccessInvitationDecision("grant-1", "delegate-1", "decline", 2) {
		t.Fatal("Store access decision hash must bind decision")
	}
	if accept == HashStoreAccessInvitationDecision("grant-1", "delegate-1", "accept", 3) {
		t.Fatal("Store access decision hash must bind expected version")
	}
}

func TestStoreAccessPartnerActivationHashBindsDelegateAndVersion(t *testing.T) {
	base := HashStoreAccessPartnerActivation(" grant-1 ", " delegate-1 ", 3)
	if base == HashStoreAccessPartnerActivation("grant-1", "delegate-2", 3) || base == HashStoreAccessPartnerActivation("grant-1", "delegate-1", 4) {
		t.Fatal("Partner activation hash must bind the delegate and expected grant version")
	}
}
