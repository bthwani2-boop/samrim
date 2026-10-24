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
		if !strings.Contains(definition, "source_store_id") || !strings.Contains(definition, "SHORT_FORM") {
			t.Fatalf("missing Store-scoped reel constraint: %s", definition)
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
