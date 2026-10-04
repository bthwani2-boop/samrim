package postgres_test

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestCanonicalJourneyMigrationGraphIncludesJoiningCaseIntakeDetails(t *testing.T) {
	migrationDirectory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	records, migrationSQL, err := postgres.LoadCanonicalMigrations(migrationDirectory)
	if err != nil {
		t.Fatalf("load canonical DSH migrations: %v", err)
	}
	if len(records) != postgres.CanonicalSchemaVersion || len(migrationSQL) != postgres.CanonicalSchemaVersion {
		t.Fatalf("canonical DSH migration graph size: records=%d sql=%d schema=%d", len(records), len(migrationSQL), postgres.CanonicalSchemaVersion)
	}
	last := records[len(records)-1]
	if last.Version != postgres.CanonicalSchemaVersion || last.Name != "095_wallet_provider_intent.sql" {
		t.Fatalf("last canonical DSH migration = v%d %q; want v%d 095_wallet_provider_intent.sql", last.Version, last.Name, postgres.CanonicalSchemaVersion)
	}

	migrationByName := make(map[string]string, len(records))
	for index, record := range records {
		migrationByName[record.Name] = migrationSQL[index]
	}
	for _, required := range []string{
		"085_store_operational_availability.sql",
		"086_store_scoped_access_delegation.sql",
		"087_order_recipient_and_adjustments.sql",
		"088_store_access_invitation_reuse.sql",
		"089_store_access_permission_updates.sql",
		"090_order_store_orderability_snapshot.sql",
		"091_order_adjustment_financial_handoff.sql",
		"092_joining_case_store_intake_details.sql",
		"093_catalog_mixed_scope_and_store_skus.sql",
		"094_store_go_live_notifications.sql",
		"095_wallet_provider_intent.sql",
	} {
		if _, ok := migrationByName[required]; !ok {
			t.Fatalf("canonical DSH migration missing: %s", required)
		}
	}
	goLiveMigration := migrationByName["094_store_go_live_notifications.sql"]
	for _, required := range []string{"CREATE TABLE dsh.store_go_live_notifications", "store_published_handoff", "field_mission_completed", "field_acquisition_reward_posted", "store_go_live_notifications_actor_idx", "order|captain|field|store"} {
		if !strings.Contains(goLiveMigration, required) {
			t.Fatalf("migration 094 is missing store go-live notification requirement: %s", required)
		}
	}
	providerIntentMigration := migrationByName["095_wallet_provider_intent.sql"]
	for _, required := range []string{"joining_cases_wallet_provider_key_chk", "field_admissions_wallet_provider_key_chk", "captain_admissions_wallet_provider_key_chk", "wallet_provider_key text"} {
		if !strings.Contains(providerIntentMigration, required) {
			t.Fatalf("migration 095 is missing wallet provider intent requirement: %s", required)
		}
	}
	if !strings.Contains(migrationByName["085_store_operational_availability.sql"], "CREATE TABLE dsh.store_operational_availability") || !strings.Contains(migrationByName["085_store_operational_availability.sql"], "schedule_timezone text NOT NULL DEFAULT 'Asia/Aden'") {
		t.Fatal("migration 085 is missing canonical Store orderability state")
	}
	if !strings.Contains(migrationByName["086_store_scoped_access_delegation.sql"], "CREATE TABLE dsh.store_access_grants") || !strings.Contains(migrationByName["086_store_scoped_access_delegation.sql"], "ARRAY['orders','catalog','store_operations']") {
		t.Fatal("migration 086 is missing bounded Store access grants")
	}
	if !strings.Contains(migrationByName["088_store_access_invitation_reuse.sql"], "WHERE state IN ('pending_role_admission','pending_partner_activation','active','suspended')") || !strings.Contains(migrationByName["088_store_access_invitation_reuse.sql"], "store_access_grants_store_delegate_idx") {
		t.Fatal("migration 088 does not release expired invitations while preserving one current grant")
	}
	if !strings.Contains(migrationByName["089_store_access_permission_updates.sql"], "grant_permissions_update") || !strings.Contains(migrationByName["089_store_access_permission_updates.sql"], "grant_permissions_changed") || !strings.Contains(migrationByName["089_store_access_permission_updates.sql"], "partner_activation_confirm") {
		t.Fatal("migration 089 does not audit and constrain permission changes")
	}
	if !strings.Contains(migrationByName["086_store_scoped_access_delegation.sql"], "pending_partner_activation") || !strings.Contains(migrationByName["086_store_scoped_access_delegation.sql"], "partner_activation_confirmed") {
		t.Fatal("migration 086 is missing the accepted role-admission and Partner activation states")
	}
	orderMigration := migrationByName["087_order_recipient_and_adjustments.sql"]
	for _, required := range []string{
		"ALTER TABLE dsh.commerce_orders",
		"ADD COLUMN recipient_mode",
		"recipient_phone_e164 IS NOT NULL",
		"CREATE TABLE dsh.commerce_order_adjustments",
		"actual_quantity_base_units IS NOT NULL",
		"REFERENCES dsh.commerce_orders(id)",
		"REFERENCES dsh.commerce_order_lines(id)",
	} {
		if !strings.Contains(orderMigration, required) {
			t.Fatalf("migration 087 is missing canonical commerce-order adjustment step: %s", required)
		}
	}
	if strings.Contains(orderMigration, "dsh.orders") || strings.Contains(orderMigration, "dsh.order_lines") || strings.Contains(orderMigration, "CREATE TABLE dsh.order_adjustments") {
		t.Fatal("migration 087 retains a losing non-commerce order schema path")
	}
	catalogMigration := migrationByName["093_catalog_mixed_scope_and_store_skus.sql"]
	for _, required := range []string{
		"DROP COLUMN catalog_model",
		"identifier_type IN ('GTIN','EAN','UPC','LEGACY_BARCODE')",
		"CREATE UNIQUE INDEX catalog_variant_identifiers_store_sku_uq",
		"p.scope='SHARED' AND p.store_id IS NULL",
		"p.scope='STORE_SCOPED' AND p.store_id=o.store_id",
		"old_price_minor",
		"new_price_minor",
		"provenance",
	} {
		if !strings.Contains(catalogMigration, required) {
			t.Fatalf("migration 093 is missing mixed-catalog requirement: %s", required)
		}
	}
	financialHandoffMigration := migrationByName["091_order_adjustment_financial_handoff.sql"]
	for _, required := range []string{"ORDER_ADJUSTMENT_RECONCILIATION", "amount_minor=0", "captain_actor_id IS NULL", "partner_actor_id IS NULL"} {
		if !strings.Contains(financialHandoffMigration, required) {
			t.Fatalf("migration 091 is missing zero-movement order adjustment handoff condition: %s", required)
		}
	}
}
