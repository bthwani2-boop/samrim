package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Merchant-owned banner drafts reuse the canonical DSH Store and media records,
// but marketplace publication must reject an independent Store even if its
// marketplace publication invariant is deliberately broken in this child DB.
func TestIndependentStoreBannerDraftRejectsMarketplacePublication(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required for independent banner proof")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const city = "ind-banner-city"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'مدينة تجريبية',true)", city); err != nil {
			t.Fatal(err)
		}
		for _, store := range []string{"ind-banner-market", "ind-banner-own"} {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
				ID: store, PartnerActorID: store + "-owner", Name: store, ServiceCityID: city, PublicationState: "published",
			})
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_products(id,canonical_name,scope,vertical_id,store_id)
				VALUES($1,'منتج اختبار','STORE_SCOPED',$2,$3)`, store+"-product", store+"-vertical", store); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit)
				VALUES($1,$2,'قطعة','DISCRETE','COUNT')`, store+"-variant", store+"-product"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,pricing_basis,
				pricing_unit_base_units,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,inventory_policy,
				publication_state,availability)
				VALUES($1,$2,$3,1500,'DISCRETE','PER_UNIT',1,1,10,1,'AVAILABILITY_ONLY','published',true)`,
				store+"-offer", store, store+"-variant"); err != nil {
				t.Fatal(err)
			}
			asset := store + "-asset"
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets
				(id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
				 state,creator,source_description,rights_statement,rights_attested_by_actor_id)
				VALUES($1,$2,$3,$4,$5,$6,'image/png',128,'active','Owner','Owned image','Rights','test-actor')`,
				asset, asset+"-idem", postgres.HashMarketingFacts(asset), "draft/"+asset,
				"asset://"+asset, strings.Repeat("a", 64)); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content
				(id,kind,title_ar,media_asset_id,target_type,target_id,source_store_id,service_city_id,state,starts_at,ends_at,created_by_actor_id,partner_enabled)
				VALUES($1,'BANNER','بنر خاص',$2,'STORE',$3,$4,$5,'DRAFT',now()-interval '1 hour',now()+interval '1 day',$6,true)`,
				store+"-content", asset, store, store, city, store+"-owner"); err != nil {
				t.Fatal(err)
			}
		}
		banners, err := postgres.ListPartnerStoreBanners(ctx, db, "ind-banner-own")
		if err != nil || len(banners) != 1 || banners[0].ID != "ind-banner-own-content" || banners[0].State != "DRAFT" {
			t.Fatalf("independent Store owner cannot read own saved banner draft: %+v err=%v", banners, err)
		}
		// This breaks the production relation constraint ONLY in a database
		// created by withFreshDatabase, to prove application-level rejection.
		if _, err := db.ExecContext(ctx, "ALTER TABLE dsh.stores DROP CONSTRAINT stores_independent_market_publication_chk"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE' WHERE id='ind-banner-own'`); err != nil {
			t.Fatal(err)
		}
		market, replay, err := postgres.SetDiscoveryContentState(ctx, db, "ind-banner-market-content", "PUBLISHED",
			"market-banner-pub-key", postgres.HashMarketingFacts("market-banner-pub"), 1)
		if err != nil || replay || market.State != "PUBLISHED" {
			t.Fatalf("marketplace Store banner publication unexpectedly failed: %+v replay=%v err=%v", market, replay, err)
		}
		_, _, err = postgres.SetDiscoveryContentState(ctx, db, "ind-banner-own-content", "PUBLISHED",
			"ind-banner-pub-key", postgres.HashMarketingFacts("ind-banner-pub"), 1)
		if !errors.Is(err, postgres.ErrDiscoveryContentTargetInvalid) {
			t.Fatalf("independent Store banner was eligible for marketplace publication: %v", err)
		}
		item, err := postgres.ReadDiscoveryContent(ctx, db, "ind-banner-own-content")
		if err != nil || item.State != "DRAFT" || item.Version != 1 {
			t.Fatalf("denied publication changed canonical draft: %+v err=%v", item, err)
		}
		var mutationCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_marketing_mutation_idempotency WHERE idempotency_key='ind-banner-pub-key'").Scan(&mutationCount); err != nil || mutationCount != 0 {
			t.Fatalf("denied publication committed an idempotency success: count=%d err=%v", mutationCount, err)
		}
	})
}
