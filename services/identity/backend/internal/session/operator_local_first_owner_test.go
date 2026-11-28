package session

import (
	"database/sql"
	"errors"
	"testing"
)

func TestLocalFirstOwnerModeBoundToExistingDevelopmentOwner(t *testing.T) {
	db, err := sql.Open("postgres", "host=localhost dbname=never_connect sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for _, tc := range []struct {
		name, schema, origin          string
		originAdmitted, ownerAdmitted bool
	}{
		{"canonical development owner", "identity_test_docker_2e1e6ae0ba6b", localOperatorOrigin, true, true},
		{"unknown isolated schema", "identity_test_different", localOperatorOrigin, true, false},
		{"retired first-owner sandbox", "identity_test_operator_s02", localOperatorOrigin, true, false},
		{"retired browser origin", "identity_test_docker_2e1e6ae0ba6b", "http://localhost:23100", false, false},
		{"retired tunnel target", "identity_test_docker_2e1e6ae0ba6b", "http://localhost:23010", false, false},
		{"unadmitted local port", "identity_test_docker_2e1e6ae0ba6b", "http://localhost:3300", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			policy := OperatorPasskeyOriginPolicy{RPID: "localhost", Origins: []string{tc.origin}}
			auth, err := NewOperatorPasskeyAuth(&PostgresReader{db: db, schema: tc.schema}, policy, true)
			if !tc.originAdmitted {
				if !errors.Is(err, ErrOperatorPasskeyOrigin) || auth != nil {
					t.Fatalf("unadmitted origin created authentication owner: %v", err)
				}
				return
			}
			if err != nil || auth == nil {
				t.Fatalf("canonical RP refused: %v", err)
			}
			err = auth.AllowLocalDevelopmentFirstOwner()
			if (err == nil) != tc.ownerAdmitted || auth.allowExistingSyntheticOperators != tc.ownerAdmitted {
				t.Fatalf("owner admission mismatch: %v", err)
			}
		})
	}
	if err := (*OperatorPasskeyAuth)(nil).AllowLocalDevelopmentFirstOwner(); err == nil {
		t.Fatal("nil owner must never enable local first-owner mode")
	}
}
