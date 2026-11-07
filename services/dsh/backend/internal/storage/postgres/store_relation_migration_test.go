package postgres

import (
	"strings"
	"testing"
)

// A Store relationship is independent of the existing marketplace publication
// flag; a migrated independent Store must never become marketplace-published.
func TestStoreRelationMigrationRegisteredAndFailClosed(t *testing.T) {
	records, sqls, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != SchemaVersion || len(sqls) != SchemaVersion {
		t.Fatalf("unexpected migration count: %d / %d", len(records), len(sqls))
	}
	last := records[171]
	if last.Version != 172 || last.Name != "172_store_relation_foundation.sql" {
		t.Fatalf("unexpected store relation migration: %+v", last)
	}
	statement := sqls[171]
	for _, required := range []string{
		"ADD COLUMN relation_model text NOT NULL DEFAULT 'BTHWANI_PARTNER'",
		"CHECK (relation_model IN ('BTHWANI_PARTNER', 'INDEPENDENT_STORE')) NOT VALID",
		"CHECK (relation_model = 'BTHWANI_PARTNER' OR publication_state <> 'published') NOT VALID",
	} {
		if !strings.Contains(statement, required) {
			t.Errorf("missing Store relation invariant %q", required)
		}
	}
}
