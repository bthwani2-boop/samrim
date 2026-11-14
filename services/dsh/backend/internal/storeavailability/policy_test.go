package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestPostgresPolicySourceRejectsMissingDBAndUntrustedSchema(t *testing.T) {
	if _, err := NewPostgresPolicySource(nil, "dsh_test_foo"); !errors.Is(err, ErrInvalidChange) {
		t.Fatalf("nil policy database: %v", err)
	}
	var db *sql.DB = &sql.DB{}
	if _, err := NewPostgresPolicySource(db, "dsh; DROP TABLE stores"); !errors.Is(err, ErrInvalidChange) {
		t.Fatalf("untrusted policy schema: %v", err)
	}
	if _, err := NewPostgresPolicySource(db, "dsh_availability"); err != nil {
		t.Fatalf("valid policy schema: %v", err)
	}
}

func TestPolicyZeroVersionCannotAuthorizeStoreMutation(t *testing.T) {
	// A provider that has not read an owner-backed version cannot authorize a change.
	count := 0
	svc, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}},
		fakeGrant{}, fakePolicy{versionZero: true}, fakeRepo{applies: &count})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = svc.Change(context.Background(), "verified-token", validChange())
	if !errors.Is(err, ErrPolicyUnavailable) || count != 0 {
		t.Fatalf("unversioned policy allowed a mutation: %v, count=%d", err, count)
	}
}
