package session

import (
	"database/sql"
	"testing"
)

func TestLocalFirstOwnerModeBoundToExistingDevelopmentOwner(t *testing.T) {
	db, err := sql.Open("postgres", "host=localhost dbname=never_connect sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	policy := OperatorPasskeyOriginPolicy{
		RPID:    "localhost",
		Origins: []string{"http://localhost:13000"},
	}
	for _, tc := range []struct {
		name, schema, origin string
		allowed              bool
	}{
		{"existing development schema and exact origin", "identity_test_docker_2e1e6ae0ba6b", "http://localhost:13000", true},
		{"unknown isolated schema", "identity_test_different", "http://localhost:13000", false},
		{"isolated first-owner sandbox", "identity_test_operator_s02", "http://localhost:13000", false},
		{"different browser address", "identity_test_docker_2e1e6ae0ba6b", "http://localhost:23100", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := policy
			p.Origins = []string{tc.origin}
			auth, err := NewOperatorPasskeyAuth(&PostgresReader{db: db, schema: tc.schema}, p, true)
			if err != nil {
				t.Fatal(err)
			}
			err = auth.AllowLocalDevelopmentFirstOwner()
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%v err=%v", tc.allowed, err)
			}
			if auth.allowExistingSyntheticOperators != tc.allowed {
				t.Fatal("authorization mode does not match guard")
			}
		})
	}
	if err := (*OperatorPasskeyAuth)(nil).AllowLocalDevelopmentFirstOwner(); err == nil {
		t.Fatal("nil owner must never enable local first-owner mode")
	}
}
