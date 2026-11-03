package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Runs against a disposable freshly migrated DB, never changing the active
// local DSH database. Ensures the actual SQL migration admits canonical videos.
func TestFreshReelsMediaMigration(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set DSH_DATABASE_URL to prove migration on a disposable DB")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqlSources []string) {
		if err := postgres.Migrate(ctx, db, records, sqlSources, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("fresh DSH migration failed: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("fresh DSH schema failed: %v", err)
		}
		var definition string
		if err := db.QueryRowContext(ctx, `SELECT pg_get_constraintdef(oid)
           FROM pg_constraint WHERE conrelid='dsh.discovery_content_media_assets'::regclass
           AND conname='discovery_content_media_type_chk'`).Scan(&definition); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(definition, "video/mp4") || !strings.Contains(definition, "image/jpeg") {
			t.Fatalf("migration failed to keep image and MP4 in the canonical media constraint: %s", definition)
		}
		if err := db.QueryRowContext(ctx, "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='dsh.discovery_content'::regclass AND conname='discovery_content_partner_source_chk'").Scan(&definition); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(definition, "source_store_id") || !strings.Contains(definition, "SHORT_FORM") || !strings.Contains(definition, "BANNER") {
			t.Fatalf("missing Store-scoped video/banner constraint: %s", definition)
		}
		var bannerEnabledDefault string
		if err := db.QueryRowContext(ctx, `SELECT COALESCE(column_default,'') FROM information_schema.columns WHERE table_schema='dsh' AND table_name='discovery_content' AND column_name='partner_enabled'`).Scan(&bannerEnabledDefault); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(bannerEnabledDefault, "true") {
			t.Fatalf("missing default Partner-owned banner visibility: %s", bannerEnabledDefault)
		}

		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "reel-store-a", PartnerActorID: "reel-actor-a", Name: "Reel Store A"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "reel-store-b", PartnerActorID: "reel-actor-b", Name: "Reel Store B"})
		queries := []string{
			"INSERT INTO dsh.catalog_products(id,canonical_name,scope,vertical_id) VALUES('reel-central-product','Shared reel product','SHARED','reel-store-a-vertical')",
			"INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit) VALUES('reel-central-variant','reel-central-product','Single','DISCRETE','COUNT')",
			"INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,pricing_basis,pricing_unit_base_units) VALUES('reel-offer-a','reel-store-a','reel-central-variant',2500,'DISCRETE','PER_UNIT',1)",
			"INSERT INTO dsh.commerce_promotions(id,code,name_ar,kind,value_minor,starts_at,created_by_actor_id,store_id,funding_source) VALUES('reel-promo-a','REELPROMOA','Reel Promo A','FIXED',50,clock_timestamp(),'reel-actor-a','reel-store-a','PARTNER')",
		}
		for _, query := range queries {
			if _, err := db.ExecContext(ctx, query); err != nil {
				t.Fatalf("fixture failed: %v: %s", err, query)
			}
		}
		for _, tc := range []struct {
			store, kind, target string
			allowed             bool
		}{
			{"reel-store-a", "STORE", "reel-store-a", true},
			{"reel-store-a", "PRODUCT", "reel-central-product", true},
			{"reel-store-a", "PROMOTION", "reel-promo-a", true},
			{"reel-store-b", "STORE", "reel-store-a", false},
			{"reel-store-b", "PRODUCT", "reel-central-product", false},
			{"reel-store-b", "PROMOTION", "reel-promo-a", false},
			{"reel-store-a", "INFO", "", false},
		} {
			owned, err := postgres.PartnerReelTargetBelongsToStore(ctx, db, tc.store, tc.kind, tc.target)
			if err != nil {
				t.Fatal(err)
			}
			if owned != tc.allowed {
				t.Fatalf("Store=%s type=%s target=%s ownership=%v want %v", tc.store, tc.kind, tc.target, owned, tc.allowed)
			}
		}
		for _, tc := range []struct {
			store string
			count int
		}{{"reel-store-a", 2}, {"reel-store-b", 0}} {
			targets, err := postgres.ListPartnerReelTargets(ctx, db, tc.store)
			if err != nil {
				t.Fatal(err)
			}
			if len(targets) != tc.count {
				t.Fatalf("targets for %s: got %+v, wanted %d", tc.store, targets, tc.count)
			}
		}
	})
}

// Rehearse the retained v168 boundary: existing platform content and Store reels
// must survive the layout/search/Partner-banner migrations without changed meaning.
func TestPartnerBannerUpgradeFromV168PreservesDiscoveryContent(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.ExecContext(ctx, `CREATE TABLE dsh.schema_migrations (
			version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
		)`); err != nil {
			t.Fatal(err)
		}
		for index := 0; index < 168; index++ {
			if _, err := tx.ExecContext(ctx, migrations[index]); err != nil {
				t.Fatalf("bootstrap v%d: %v", index+1, err)
			}
			record := records[index]
			if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version,name,sha256) VALUES($1,$2,$3)",
				record.Version, record.Name, record.SHA256); err != nil {
				t.Fatalf("record v%d: %v", record.Version, err)
			}
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}

		const storeID = "upgrade-banner-store"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: storeID, PartnerActorID: "upgrade-banner-owner", Name: "Upgrade Store",
		})
		for _, content := range []struct {
			id, kind, targetType, targetID, sourceStoreID string
		}{
			{"upgrade-platform-banner", "BANNER", "INFO", "", ""},
			{"upgrade-store-reel", "SHORT_FORM", "STORE", storeID, storeID},
		} {
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
				id,kind,title_ar,target_type,target_id,source_store_id,starts_at,created_by_actor_id)
				VALUES($1,$2,'محتوى محفوظ',$3,NULLIF($4,''),NULLIF($5,''),clock_timestamp()-interval '1 hour','upgrade-proof')`,
				content.id, content.kind, content.targetType, content.targetID, content.sourceStoreID); err != nil {
				t.Fatalf("seed retained content %s: %v", content.id, err)
			}
		}
		type savedContent struct {
			kind, title, targetType, targetID, sourceStoreID, state string
			version                                                 int
		}
		readContent := func(id string) savedContent {
			t.Helper()
			var content savedContent
			if err := db.QueryRowContext(ctx, `SELECT kind,title_ar,target_type,COALESCE(target_id,''),
				COALESCE(source_store_id,''),state,version FROM dsh.discovery_content WHERE id=$1`, id).
				Scan(&content.kind, &content.title, &content.targetType, &content.targetID,
					&content.sourceStoreID, &content.state, &content.version); err != nil {
				t.Fatalf("read retained content %s: %v", id, err)
			}
			return content
		}
		beforeBanner := readContent("upgrade-platform-banner")
		beforeReel := readContent("upgrade-store-reel")
		const storeBannerSQL = `INSERT INTO dsh.discovery_content(
			id,kind,title_ar,target_type,target_id,source_store_id,starts_at,created_by_actor_id)
			VALUES('upgrade-store-banner','BANNER','إعلان متجر','STORE',$1,$1,clock_timestamp()-interval '1 hour','upgrade-proof')`
		if _, err := db.ExecContext(ctx, storeBannerSQL, storeID); err == nil ||
			!strings.Contains(err.Error(), "discovery_content_partner_source_chk") {
			t.Fatalf("v168 must reject Partner-owned banners: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("upgrade from v168 to v%d: %v", postgres.SchemaVersion, err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("upgraded canonical schema: %v", err)
		}
		if after := readContent("upgrade-platform-banner"); after != beforeBanner {
			t.Fatalf("legacy platform banner changed: before=%+v after=%+v", beforeBanner, after)
		}
		if after := readContent("upgrade-store-reel"); after != beforeReel {
			t.Fatalf("legacy Store reel changed: before=%+v after=%+v", beforeReel, after)
		}
		var validated bool
		if err := db.QueryRowContext(ctx, `SELECT convalidated FROM pg_constraint
			WHERE conrelid='dsh.discovery_content'::regclass
			AND conname='discovery_content_partner_source_chk'`).Scan(&validated); err != nil || !validated {
			t.Fatalf("Partner source constraint is not valid: valid=%v err=%v", validated, err)
		}
		for _, id := range []string{"upgrade-platform-banner", "upgrade-store-reel"} {
			var enabled bool
			if err := db.QueryRowContext(ctx,
				"SELECT partner_enabled FROM dsh.discovery_content WHERE id=$1", id).Scan(&enabled); err != nil || !enabled {
				t.Fatalf("retained content %s not default-enabled: %v", id, err)
			}
		}
		if _, err := db.ExecContext(ctx, storeBannerSQL, storeID); err != nil {
			t.Fatalf("v171 should admit Store-owned banner: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
			id,kind,title_ar,target_type,target_id,source_store_id,starts_at,created_by_actor_id)
			VALUES('upgrade-invalid-banner','BANNER','وجهة غير مسموحة','INFO',NULL,$1,
				clock_timestamp()-interval '1 hour','upgrade-proof')`, storeID); err == nil ||
			!strings.Contains(err.Error(), "discovery_content_partner_source_chk") {
			t.Fatalf("Partner-owned banner cannot target INFO: %v", err)
		}
	})
}
