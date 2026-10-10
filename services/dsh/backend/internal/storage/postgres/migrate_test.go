package postgres_test

import (
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

const (
	testPartnerActorID  = "act_partner_catalog_v1"
	testOperatorActorID = "act_operator_catalog_v1"
)

func assertRequiredMigrationOrder(t *testing.T, records []postgres.MigrationRecord, required ...string) {
	t.Helper()
	lastIndex := -1
	for _, name := range required {
		foundIndex := -1
		for index, record := range records {
			if record.Name == name {
				foundIndex = index
				break
			}
		}
		if foundIndex <= lastIndex {
			t.Fatalf("required DSH migration is missing or out of order: %s", name)
		}
		lastIndex = foundIndex
	}
}

func TestCanonicalMigrationGraphMatchesSchemaVersion(t *testing.T) {
	records, migrationSQL, err := postgres.LoadMigrations()
	if err != nil {
		t.Fatalf("load DSH canonical migrations: %v", err)
	}
	if len(records) != postgres.SchemaVersion || len(migrationSQL) != postgres.SchemaVersion {
		t.Fatalf("unexpected DSH migration graph size: records=%d sql=%d schema=%d", len(records), len(migrationSQL), postgres.SchemaVersion)
	}
	last := records[len(records)-1]
	if last.Version != postgres.SchemaVersion || last.Name != "108_backfill_joining_hours_into_orderability.sql" {
		t.Fatalf("last DSH migration = v%d %q; want v%d 108_backfill_joining_hours_into_orderability.sql", last.Version, last.Name, postgres.SchemaVersion)
	}
	migrationByName := make(map[string]string, len(records))
	for index, record := range records {
		migrationByName[record.Name] = migrationSQL[index]
	}
	if !strings.Contains(migrationByName["064_partner_captain_cash_at_store_payment.sql"], "fulfillment_mode IN ('PARTNER_CAPTAIN', 'CUSTOMER_PICKUP') AND payment_method = 'CASH_AT_STORE'") {
		t.Fatal("DSH migration 064 does not bind partner-captain fulfillment to cash at store")
	}
	if !strings.Contains(migrationByName["065_marketing_operational_registries.sql"], "commerce_promotions_starts_registry_idx") || !strings.Contains(migrationByName["065_marketing_operational_registries.sql"], "discovery_content_created_registry_idx") {
		t.Fatal("DSH migration 065 is missing marketing registry indexes")
	}
	if !strings.Contains(migrationByName["066_catalog_category_media.sql"], "catalog_category_media_assets_active_uq") || !strings.Contains(migrationByName["066_catalog_category_media.sql"], "ADD COLUMN image_uri text") {
		t.Fatal("DSH migration 066 is missing category media ownership schema")
	}
	if !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "ADD COLUMN cleaned_at timestamptz") || !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "store_profile_media_cleaned_at_chk") || !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "cleanup_claimed_at") || !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "last_attempt_at") || !strings.Contains(migrationByName["067_store_profile_media_cleanup.sql"], "last_upload_error") {
		t.Fatal("DSH migration 067 is missing store profile media cleanup state")
	}
	mediaProvenanceMigration := migrationByName["072_store_profile_media_provenance.sql"]
	if !strings.Contains(mediaProvenanceMigration, "rights_attested_by_actor_id") || !strings.Contains(mediaProvenanceMigration, "rights_attested_at") || !strings.Contains(mediaProvenanceMigration, "store_profile_media_provenance_chk") || !strings.Contains(mediaProvenanceMigration, "SET state = 'retired', retired_at = clock_timestamp()") {
		t.Fatal("DSH migration 072 is missing attributed media provenance or retirement of unverified legacy images")
	}
	productMediaReferenceMigration := migrationByName["073_catalog_media_asset_references.sql"]
	for _, required := range []string{"SET media_asset_id = asset.id", "WHERE media_asset_id IS NULL", "state = 'retired'", "DROP COLUMN uri", "FOREIGN KEY (product_id, media_asset_id)", "UNIQUE (product_id, media_asset_id)", "DROP COLUMN proposed_image_uri"} {
		if !strings.Contains(productMediaReferenceMigration, required) {
			t.Fatalf("DSH migration 073 is missing the product media asset cutover step: %s", required)
		}
	}
	catalogMediaProvenanceMigration := migrationByName["074_catalog_media_provenance.sql"]
	for _, required := range []string{"DROP COLUMN image_uri", "TRUNCATE TABLE dsh.catalog_media", "request_hash", "rights_attested_by_actor_id", "rights_attested_at", "catalog_media_assets_provenance_chk", "catalog_category_media_assets_provenance_chk"} {
		if !strings.Contains(catalogMediaProvenanceMigration, required) {
			t.Fatalf("DSH migration 074 is missing catalog media provenance cutover: %s", required)
		}
	}
	discoveryContentMediaMigration := migrationByName["075_discovery_content_media_assets.sql"]
	for _, required := range []string{"DROP COLUMN media_uri", "media_asset_id", "discovery_content_media_assets", "rights_attested_by_actor_id", "discovery_content_published_media_chk", "state = 'PAUSED'"} {
		if !strings.Contains(discoveryContentMediaMigration, required) {
			t.Fatalf("DSH migration 075 is missing discovery content media ownership cutover: %s", required)
		}
	}
	paymentCashSnapshotMigration := migrationByName["076_payment_cash_amount_snapshot.sql"]
	for _, required := range []string{"ADD COLUMN payment_cash_amount_minor bigint", "SET payment_cash_amount_minor = total_amount_minor", "payment_cash_amount_minor <= total_amount_minor"} {
		if !strings.Contains(paymentCashSnapshotMigration, required) {
			t.Fatalf("DSH migration 076 is missing payment cash snapshot behavior: %s", required)
		}
	}
	balanceOnlyHandoffMigration := migrationByName["077_balance_only_financial_handoffs.sql"]
	for _, required := range []string{"PARTNER_CAPTAIN_BALANCE_SETTLEMENT", "effect_type='DELIVERY_SETTLEMENT' AND amount_minor>=0", "effect_type='STORE_PICKUP_COLLECTION' AND amount_minor>=0"} {
		if !strings.Contains(balanceOnlyHandoffMigration, required) {
			t.Fatalf("DSH migration 077 is missing balance-only settlement behavior: %s", required)
		}
	}
	catalogOfferVisibilityMigration := migrationByName["078_catalog_offer_visibility_views.sql"]
	for _, required := range []string{"CREATE OR REPLACE VIEW dsh.catalog_publishable_offers", "o.quantity_policy<>'VARIABLE_MEASURE'", "CREATE OR REPLACE VIEW dsh.catalog_customer_visible_offers", "s.publication_state='published'"} {
		if !strings.Contains(catalogOfferVisibilityMigration, required) {
			t.Fatalf("DSH migration 078 is missing canonical catalog offer visibility: %s", required)
		}
	}
	assertRequiredMigrationOrder(t, records, "072_store_profile_media_provenance.sql", "073_catalog_media_asset_references.sql", "074_catalog_media_provenance.sql", "075_discovery_content_media_assets.sql", "076_payment_cash_amount_snapshot.sql", "077_balance_only_financial_handoffs.sql", "078_catalog_offer_visibility_views.sql")
	if !strings.Contains(migrationByName["068_field_operator_partner_admission.sql"], "admission_requested") || !strings.Contains(migrationByName["068_field_operator_partner_admission.sql"], "joining_case_admission_requested") || !strings.Contains(migrationByName["068_field_operator_partner_admission.sql"], "field-admission-request") {
		t.Fatal("DSH migration 068 is missing the Field submission and Operator admission state")
	}
	cityMigration := migrationByName["103_field_city_assignments.sql"]
	if !strings.Contains(cityMigration, "all_service_cities") || !strings.Contains(cityMigration, "field_admission_service_cities") || !strings.Contains(cityMigration, "SELECT id, service_city_id FROM dsh.field_admissions WHERE service_city_id IS NOT NULL") {
		t.Fatal("Field city assignment migration must preserve the existing single-city assignment while adding multi-city and all-active scope")
	}
	cityCutover := migrationByName["104_field_city_assignment_cutover.sql"]
	if !strings.Contains(cityCutover, "DROP COLUMN service_city_id") || !strings.Contains(cityCutover, "field_admissions_pending_service_city_chk") {
		t.Fatal("Field city assignment cutover must remove the obsolete single-city owner after the migration 103 backfill")
	}
	if draftReadiness := migrationByName["105_field_draft_fulfillment_readiness.sql"]; !strings.Contains(draftReadiness, "state = 'draft' OR cardinality(first_store_fulfillment_modes) > 0") || !strings.Contains(draftReadiness, "first_store_fulfillment_modes <@ ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']") {
		t.Fatal("Field drafts must permit unselected fulfillment while retaining the supported-mode allowlist")
	}
	attributeLifecycleMigration := migrationByName["107_catalog_attribute_lifecycle.sql"]
	for _, required := range []string{"ADD COLUMN version integer NOT NULL DEFAULT 1", "ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp()", "'attribute_definition', 'attribute_enum_option'"} {
		if !strings.Contains(attributeLifecycleMigration, required) {
			t.Fatalf("DSH migration 107 is missing attribute lifecycle storage: %s", required)
		}
	}
	if !strings.Contains(migrationByName["069_catalog_store_offer_paging.sql"], "catalog_store_offers_store_created_registry_idx") || !strings.Contains(migrationByName["069_catalog_store_offer_paging.sql"], "ON dsh.catalog_store_offers (store_id, created_at, id)") {
		t.Fatal("DSH migration 069 is missing the StoreOffer keyset paging index")
	}
	if !strings.Contains(migrationByName["070_public_store_discovery_pagination.sql"], "stores_published_city_created_registry_idx") || !strings.Contains(migrationByName["070_public_store_discovery_pagination.sql"], "stores_published_city_name_search_idx") || !strings.Contains(migrationByName["070_public_store_discovery_pagination.sql"], "gin_trgm_ops") {
		t.Fatal("DSH migration 070 is missing Store discovery search and ordering indexes")
	}
	for _, required := range []string{
		"ADD COLUMN requires_profile_review boolean NOT NULL DEFAULT false",
		"WHERE state IN ('eligible','suspended') AND actor_id IS NOT NULL AND full_name_ar IS NULL",
		"field_admissions_profile_review_chk",
		"captain_admissions_profile_review_chk",
		"field_admission_profile_reviewed",
		"captain_admission_profile_reviewed",
	} {
		if !strings.Contains(migrationByName["071_field_captain_profiles_and_review.sql"], required) {
			t.Fatalf("DSH migration 071 is missing the profile review closure: %s", required)
		}
	}
	dsh071 := migrationByName["071_field_captain_profiles_and_review.sql"]
	for _, pair := range [][2]string{
		{"DROP CONSTRAINT field_admission_idempotency_state_chk", "UPDATE dsh.field_admission_idempotency SET result_state='pending_review'"},
		{"DROP CONSTRAINT captain_admission_idempotency_state_chk", "UPDATE dsh.captain_admission_idempotency SET result_state='pending_review'"},
	} {
		if strings.Index(dsh071, pair[0]) < 0 || strings.Index(dsh071, pair[0]) > strings.Index(dsh071, pair[1]) {
			t.Fatalf("DSH migration 071 must widen the idempotency state constraint before backfill: %s", pair[0])
		}
	}
	for _, preserved := range []string{"'correct'", "'correct_and_resubmit'", "'bind-financial-terms'", "'joining_case_corrected'", "'joining_case_corrected_and_resubmitted'", "'joining_case_financial_terms_bound'", "'joining_case_admission_reopened'"} {
		if !strings.Contains(migrationByName["068_field_operator_partner_admission.sql"], preserved) {
			t.Fatalf("DSH migration 068 dropped existing joining-case constraint value %s", preserved)
		}
	}
}
