package postgres

import (
	"strings"
	"testing"
)

func TestRestoredLegalNameConstraintDefinitionIsNarrowlyAccepted(t *testing.T) {
	var legalName schemaConstraint
	for _, candidate := range identitySchemaConstraints {
		if candidate.table == "identity_actor_legal_name_versions" &&
			candidate.name == "identity_actor_legal_name_parts_chk" {
			legalName = candidate
			break
		}
	}
	if legalName.definition == "" || legalName.restoredDefinition == "" {
		t.Fatal("the legal-name constraint must retain both the canonical and observed restored renderings")
	}

	cases := []struct {
		name       string
		definition string
		want       bool
	}{
		{name: "migration canonical form", definition: legalName.definition, want: true},
		{name: "postgres restore reserialization", definition: legalName.restoredDefinition, want: true},
		{name: "changed upper bound", definition: strings.Replace(legalName.restoredDefinition, "given_name)) <= 80", "given_name)) <= 81", 1), want: false},
		{name: "changed boolean operator", definition: strings.Replace(legalName.restoredDefinition, " AND ((length(btrim(second_name))", " OR ((length(btrim(second_name))", 1), want: false},
		{name: "missing predicate", definition: strings.Replace(legalName.restoredDefinition, " AND ((length(btrim(family_name)) >= 1) AND (length(btrim(family_name)) <= 80))", "", 1), want: false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := matchesExpectedConstraintDefinition(test.definition, legalName); got != test.want {
				t.Fatalf("matchesExpectedConstraintDefinition() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestOtherConstraintsDoNotAcceptRestoreRendering(t *testing.T) {
	for _, constraint := range identitySchemaConstraints {
		if constraint.name == "identity_actor_legal_name_parts_chk" {
			continue
		}
		if constraint.restoredDefinition != "" {
			t.Fatalf("unexpected restore exception on %s/%s", constraint.table, constraint.name)
		}
		if !matchesExpectedConstraintDefinition(constraint.definition, constraint) {
			t.Fatalf("canonical constraint was rejected: %s/%s", constraint.table, constraint.name)
		}
		if matchesExpectedConstraintDefinition(constraint.definition+" OR TRUE", constraint) {
			t.Fatalf("constraint drift accepted: %s/%s", constraint.table, constraint.name)
		}
	}
}
