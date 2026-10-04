package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/lib/pq"
)

func TestCatalogIdentifierV93UpgradePreservesLegacyMatchesAndConflicts(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the catalog identifier upgrade proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshCanonicalDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		cutoverIndex := -1
		for index, record := range records {
			if record.Name == "093_catalog_mixed_scope_and_store_skus.sql" {
				cutoverIndex = index
				break
			}
		}
		if cutoverIndex < 1 {
			t.Fatal("canonical migration graph omitted the catalog identifier cutover")
		}
		if _, err := db.ExecContext(ctx, `CREATE SCHEMA IF NOT EXISTS dsh;
			CREATE TABLE IF NOT EXISTS dsh.schema_migrations (
				version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL,
				applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
			)`); err != nil {
			t.Fatalf("create pre-cutover migration history: %v", err)
		}
		for index := 0; index < cutoverIndex; index++ {
			if _, err := db.ExecContext(ctx, migrationSQL[index]); err != nil {
				t.Fatalf("apply prior canonical migration %s: %v", records[index].Name, err)
			}
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version,name,sha256) VALUES($1,$2,$3)", records[index].Version, records[index].Name, records[index].SHA256); err != nil {
				t.Fatalf("record prior canonical migration %s: %v", records[index].Name, err)
			}
		}

		const storeID = "store_identifier_cutover"
		const verticalID = "vertical_identifier_cutover"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: "partner_identifier_cutover", Name: "متجر ترحيل المعرفات", PrimaryVerticalID: verticalID})
		for _, product := range []struct {
			id, variantID, name, scope, storeID string
		}{
			{id: "product_identifier_shared", variantID: "variant_identifier_shared", name: "منتج مشترك", scope: "SHARED"},
			{id: "product_identifier_scoped", variantID: "variant_identifier_scoped", name: "منتج محلي", scope: "STORE_SCOPED", storeID: storeID},
		} {
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_products(id,vertical_id,scope,store_id,canonical_name)
				VALUES($1,$2,$3,NULLIF($4,''),$5)`, product.id, verticalID, product.scope, product.storeID, product.name); err != nil {
				t.Fatalf("insert prior-baseline Product %s: %v", product.id, err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit)
				VALUES($1,$2,'افتراضي','DISCRETE','COUNT')`, product.variantID, product.id); err != nil {
				t.Fatalf("insert prior-baseline Variant %s: %v", product.variantID, err)
			}
		}
		for _, identifier := range []struct{ variantID, kind, value string }{
			{"variant_identifier_shared", "SKU", "legacy-shared-sku"},
			{"variant_identifier_scoped", "SKU", "store-local-sku"},
			{"variant_identifier_shared", "GTIN", "same-variant-alias"},
			{"variant_identifier_shared", "EAN", " same-variant-alias "},
			{"variant_identifier_shared", "UPC", "cross-variant-collision"},
			{"variant_identifier_scoped", "LEGACY_BARCODE", " cross-variant-collision "},
		} {
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value) VALUES($1,$2,$3)`, identifier.variantID, identifier.kind, identifier.value); err != nil {
				t.Fatalf("insert valid prior-baseline identifier %s/%s: %v", identifier.kind, identifier.value, err)
			}
		}

		if err := postgres.MigrateCanonical(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("upgrade prior-baseline catalog data through migration 093: %v", err)
		}
		if err := postgres.VerifyCanonicalSchema(ctx, db, records); err != nil {
			t.Fatalf("verify canonical schema after identifier upgrade: %v", err)
		}

		var legacyType string
		var legacyStoreID sql.NullString
		var legacyConflict bool
		if err := db.QueryRowContext(ctx, `SELECT identifier_type,store_id,legacy_conflict
			FROM dsh.catalog_variant_identifiers WHERE identifier_value='legacy-shared-sku'`).Scan(&legacyType, &legacyStoreID, &legacyConflict); err != nil {
			t.Fatalf("read migrated shared SKU: %v", err)
		}
		if legacyType != "LEGACY_BARCODE" || legacyStoreID.Valid || legacyConflict {
			t.Fatalf("shared SKU cutover = type %q store %v conflict %v; want preserved global legacy identifier", legacyType, legacyStoreID, legacyConflict)
		}
		var storeSKUStoreID string
		if err := db.QueryRowContext(ctx, `SELECT store_id FROM dsh.catalog_variant_identifiers WHERE identifier_value='store-local-sku'`).Scan(&storeSKUStoreID); err != nil || storeSKUStoreID != storeID {
			t.Fatalf("store-scoped SKU cutover store=%q err=%v; want %q", storeSKUStoreID, err, storeID)
		}

		sharedMatch, err := postgres.ResolveCatalogIdentifier(ctx, db, storeID, "legacy-shared-sku")
		if err != nil || sharedMatch.Outcome != "SHARED_PRODUCT_MATCH" || sharedMatch.ProductID != "product_identifier_shared" {
			t.Fatalf("shared legacy SKU stopped resolving after cutover: %+v err=%v", sharedMatch, err)
		}
		sameVariantMatch, err := postgres.ResolveCatalogIdentifier(ctx, db, storeID, "same-variant-alias")
		if err != nil || sameVariantMatch.Outcome != "SHARED_PRODUCT_MATCH" || sameVariantMatch.VariantID != "variant_identifier_shared" {
			t.Fatalf("same-variant identifier aliases became ambiguous: %+v err=%v", sameVariantMatch, err)
		}
		ambiguous, err := postgres.ResolveCatalogIdentifier(ctx, db, storeID, "cross-variant-collision")
		if err != nil || ambiguous.Outcome != "AMBIGUOUS_IDENTIFIER" {
			t.Fatalf("cross-variant legacy collision must remain safely ambiguous: %+v err=%v", ambiguous, err)
		}

		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value)
			VALUES('variant_identifier_shared','GTIN','new-global-identifier')`); err != nil {
			t.Fatalf("insert new globally unique barcode: %v", err)
		}
		_, duplicateErr := db.ExecContext(ctx, `INSERT INTO dsh.catalog_variant_identifiers(variant_id,identifier_type,identifier_value)
			VALUES('variant_identifier_scoped','EAN',' new-global-identifier ')`)
		var uniquenessErr *pq.Error
		if !errors.As(duplicateErr, &uniquenessErr) || uniquenessErr.Code != "23505" || uniquenessErr.Constraint != "catalog_variant_identifiers_global_value_uq" {
			t.Fatalf("new cross-type duplicate barcode error = %v; want SQLSTATE 23505 from catalog_variant_identifiers_global_value_uq", duplicateErr)
		}
	})
}
