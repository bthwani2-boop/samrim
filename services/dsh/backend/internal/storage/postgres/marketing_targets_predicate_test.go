package postgres

import (
	"strings"
	"testing"
)

// The predicate is SQL text, not a bound value. Only canonical internal
// fragments may ever enter its identifiers, placeholders or time expression.
func TestDiscoveryContentTargetPredicateRejectsUnapprovedSQLFragments(t *testing.T) {
	for _, input := range []struct {
		name, alias, city, at string
	}{
		{"alias", "content; DROP TABLE dsh.stores; --", "$2", "statement_timestamp()"},
		{"placeholder", "content", "$2 OR TRUE --", "statement_timestamp()"},
		{"expression", "content", "$2", "statement_timestamp()); DROP TABLE dsh.stores; --"},
		{"unapproved-combination", "target", "$2", "$4"},
	} {
		t.Run(input.name, func(t *testing.T) {
			got := discoveryContentTargetEligibilityPredicate(input.alias, input.city, input.at)
			if got != "FALSE" {
				t.Fatalf("unsafe SQL fragment accepted: %s", input.name)
			}
		})
	}
	for _, input := range []struct{ alias, city, at string }{
		{"target", "$3", "$4"},
		{"content", "$1", "statement_timestamp()"},
		{"content", "$2", "statement_timestamp()"},
	} {
		got := discoveryContentTargetEligibilityPredicate(input.alias, input.city, input.at)
		if got == "FALSE" || !strings.Contains(got, input.alias+".target_id") {
			t.Fatalf("canonical predicate rejected: %+v", input)
		}
	}
}
