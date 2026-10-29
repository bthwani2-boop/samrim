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

func TestRestoredVarcharAnyConstraintSerialization(t *testing.T) {
	var activation schemaConstraint
	for _, candidate := range identitySchemaConstraints {
		if candidate.table == "identity_actor_roles" && candidate.name == "identity_actor_role_activation_check" {
			activation = candidate
			break
		}
	}
	if activation.definition == "" {
		t.Fatal("role activation constraint is missing")
	}

	// Independent pg_get_constraintdef output observed after a real PostgreSQL
	// 18 pg_dump/pg_restore, not a string produced by the normalizer.
	restored := `CHECK ((((role)::text = ANY (ARRAY[('partner'::character varying)::text, ('captain'::character varying)::text, ('field'::character varying)::text, ('operator'::character varying)::text])) OR (activated_at IS NULL)))`
	cases := []struct {
		name   string
		actual string
		want   bool
	}{
		{name: "canonical", actual: activation.definition, want: true},
		{name: "observed restored array casts", actual: restored, want: true},
		{name: "extra role", actual: strings.Replace(restored, "('operator'::character varying)::text]", "('operator'::character varying)::text, ('admin'::character varying)::text]", 1), want: false},
		{name: "changed role", actual: strings.Replace(restored, "('partner'::character varying)::text", "('admin'::character varying)::text", 1), want: false},
		{name: "omitted role", actual: strings.Replace(restored, "('field'::character varying)::text, ", "", 1), want: false},
		{name: "different cast", actual: strings.Replace(restored, "('partner'::character varying)::text", "('partner'::text)::text", 1), want: false},
		{name: "different ANY operator", actual: strings.Replace(restored, "ANY (ARRAY", "ALL (ARRAY", 1), want: false},
		{name: "changed OR to AND", actual: strings.Replace(restored, " OR (activated_at IS NULL)", " AND (activated_at IS NULL)", 1), want: false},
		{name: "forced unconditional approval", actual: restored + " OR TRUE", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchesExpectedConstraintDefinition(tc.actual, activation); got != tc.want {
				t.Fatalf("matchesExpectedConstraintDefinition() = %v, want %v", got, tc.want)
			}
		})
	}
}
