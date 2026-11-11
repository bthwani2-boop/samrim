package postgres

import (
	"os"
	"strings"
	"testing"
)

// Migration 174 is applied in local development and must remain immutable.
// Migration 176 can only remove the duplicate writer's state if there are no
// historical records to reconcile. The SQL itself is exercised in Postgres QA.
func TestRetiredDirectOrderMigrationFailsClosedForDurableData(t *testing.T) {
	records, sqls, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != SchemaVersion || len(sqls) != SchemaVersion {
		t.Fatalf("migration graph mismatch: records=%d sql=%d version=%d", len(records), len(sqls), SchemaVersion)
	}
	if records[173].Name != "174_independent_storefront_and_direct_orders.sql" ||
		records[175].Name != "176_retire_parallel_independent_orders.sql" {
		t.Fatalf("canonical history missing retained and retiring migrations: %+v %+v", records[173], records[175])
	}
	migration := sqls[175]
	for _, table := range []string{"dsh.independent_direct_orders", "dsh.independent_direct_order_lines", "dsh.independent_direct_order_idempotency", "dsh.independent_direct_order_audit"} {
		if !strings.Contains(migration, "EXISTS (SELECT 1 FROM "+table+")") ||
			!strings.Contains(migration, "DROP TABLE "+table+";") {
			t.Errorf("retiring %s without a data-preservation guard", table)
		}
	}
	if lock := strings.Index(migration, "LOCK TABLE dsh.independent_direct_orders"); lock < 0 ||
		lock >= strings.Index(migration, "IF EXISTS (SELECT 1 FROM dsh.independent_direct_orders)") {
		t.Fatal("retirement must lock all direct-order writers before testing for records")
	}
	if !strings.Contains(migration, "RAISE EXCEPTION") || strings.Contains(migration, "CASCADE") {
		t.Fatal("retirement must fail closed rather than cascade through durable data")
	}
	source, err := os.ReadFile("schema_verification.go")
	if err != nil {
		t.Fatal(err)
	}
	expectations, err := os.ReadFile("schema_expectations.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"dsh.independent_direct_orders", "dsh.independent_direct_order_lines", "dsh.independent_direct_order_idempotency", "dsh.independent_direct_order_audit"} {
		if !strings.Contains(string(source), "retired parallel direct Order storage still exists") ||
			strings.Contains(string(expectations), "{name: \""+table+"\"") {
			t.Errorf("schema verification still treats parallel Order storage as an authoritative relation: %s", table)
		}
	}
}
