package postgres

import (
	"strings"
	"testing"
)

// Guard the authoritative migration contract. The executable behavioral
// regression is also exercised against a restored isolated database by
// audit24-g007-upgrade-clone.ps1.
func TestStoreScopedCategoryVisibilityMigration(t *testing.T) {
	records, statements, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	const catalogMigrationVersion = 140
	if len(records) != SchemaVersion || records[catalogMigrationVersion-1].Version != catalogMigrationVersion ||
		records[catalogMigrationVersion-1].Name != "140_store_scoped_catalog_categories.sql" {
		t.Fatalf("unexpected catalog migration: %+v", records[catalogMigrationVersion-1])
	}

	statement := statements[catalogMigrationVersion-1]
	requires := []string{
		"CREATE OR REPLACE VIEW dsh.catalog_publishable_offers AS",
		"p.scope='SHARED' AND EXISTS",
		"p.scope='STORE_SCOPED' AND NOT EXISTS",
		"LEFT JOIN dsh.catalog_categories c ON c.id=pc.category_id",
		"c.active=false OR c.vertical_id<>p.vertical_id",
		"NOT EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id JOIN dsh.catalog_category_attribute_rules r",
	}
	for _, clause := range requires {
		if !strings.Contains(statement, clause) {
			t.Errorf("visibility migration lost its required invariant: %s", clause)
		}
	}
	if strings.Contains(statement, "(p.scope='STORE_SCOPED' AND NOT EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc WHERE pc.product_id=p.id))") {
		t.Fatal("Store-owned category links must not silently remove published products")
	}
}
