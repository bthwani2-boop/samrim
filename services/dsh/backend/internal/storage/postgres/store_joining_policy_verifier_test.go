package postgres

import (
	"strings"
	"testing"
)

// Historical migration 173 intentionally uses an unnamed, cross-column
// CHECK. PostgreSQL names this table-level constraint
// store_joining_policy_events_check; it is NOT a result_version-column CHECK.
// Keep VerifySchema aligned with the installed historical schema without
// rewriting any applied migration SQL or checksum.
func TestJoiningPolicyEventsHistoricalCrossColumnCheckExpectation(t *testing.T) {
	records, migrations, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) < 173 || len(migrations) < 173 || records[172].Name != "173_store_joining_policies.sql" {
		t.Fatal("historical Store joining policy migration 173 changed or is missing")
	}
	migration := migrations[172]
	for _, expected := range []string{
		"CREATE TABLE dsh.store_joining_policy_events (",
		"expected_version integer NOT NULL CHECK (expected_version > 0)",
		"result_version integer NOT NULL CHECK (result_version > expected_version)",
	} {
		if !strings.Contains(migration, expected) {
			t.Errorf("historical v173 migration is missing expected invariant %q", expected)
		}
	}
	const actualName = "store_joining_policy_events_check"
	const incorrectName = "store_joining_policy_events_result_version_check"
	var target []string
	for _, relation := range requiredTables {
		if relation.name == "dsh.store_joining_policy_events" {
			if target != nil {
				t.Fatal("duplicate schema verifier expectation for Store joining policy events")
			}
			target = relation.constraints
		}
	}
	if target == nil {
		t.Fatal("schema verifier lacks Store joining policy events")
	}
	found := false
	for _, name := range target {
		switch name {
		case actualName:
			found = true
		case incorrectName:
			t.Fatalf("schema verifier must never expect a nonexistent column-specific check: %q", name)
		}
	}
	if !found {
		t.Fatalf("schema verifier must expect PostgreSQL's table-level cross-column check %q", actualName)
	}
}
