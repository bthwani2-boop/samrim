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

// A published independent Store is deliberately inconsistent with the
// production DSH constraint. Only a disposable test database may simulate
// the corruption; marketplace discovery must still fail closed.
func TestMarketplaceContentTargetRejectsPublishedIndependentOffer(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required for independent marketing isolation proof")
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
		const city = "marketing-rel-city"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'مدينة اختبار',true)", city); err != nil {
			t.Fatal(err)
		}
		stores := []string{"marketing-market-store", "marketing-independent-store"}
		for _, id := range stores {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
				ID: id, PartnerActorID: id + "-owner", Name: id, ServiceCityID: city, PublicationState: "published",
			})
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_products(id,canonical_name,scope,vertical_id,store_id)
				VALUES($1,'منتج اختبار','STORE_SCOPED',$2,$3)`, id+"-product", id+"-vertical", id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit)
				VALUES($1,$2,'قطعة','DISCRETE','COUNT')`, id+"-variant", id+"-product"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,pricing_basis,
					pricing_unit_base_units,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,inventory_policy,
					publication_state,availability)
				VALUES($1,$2,$3,1000,'DISCRETE','PER_UNIT',1,1,10,1,'AVAILABILITY_ONLY','published',true)`,
				id+"-offer", id, id+"-variant"); err != nil {
				t.Fatal(err)
			}
			contentID, assetID := id+"-content", id+"-asset"
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets
				(id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
				 state,creator,source_description,rights_statement,rights_attested_by_actor_id)
				VALUES($1,$2,$3,$4,$5,$6,'image/png',128,'active','Store owner','Authorized image','Merchant rights','test-merchant')`,
				assetID, assetID+"-idem", postgres.HashMarketingFacts(assetID), "proof/"+assetID,
				"asset://"+assetID, strings.Repeat("a", 64)); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content
				(id,kind,title_ar,media_asset_id,target_type,target_id,service_city_id,state,starts_at,ends_at,created_by_actor_id)
				VALUES($1,'BANNER','بنر اختبار',$2,'PRODUCT',$3,$4,'PUBLISHED',now()-interval '1 hour',now()+interval '1 day','test-merchant')`,
				contentID, assetID, id+"-product", city); err != nil {
				t.Fatal(err)
			}
		}
		// A published independent Store cannot exist under real production
		// DSH constraints. Remove that constraint ONLY inside this child DB,
		// then confirm a visibility view would still expose its offer.
		if _, err := db.ExecContext(ctx, "ALTER TABLE dsh.stores DROP CONSTRAINT stores_independent_market_publication_chk"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE'
			WHERE id='marketing-independent-store'`); err != nil {
			t.Fatal(err)
		}
		var visible int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.catalog_customer_visible_offers
			WHERE offer_id IN ('marketing-market-store-offer','marketing-independent-store-offer')`).Scan(&visible); err != nil || visible != 2 {
			t.Fatalf("the visibility view must include both offers for this negative proof to be meaningful: count=%d error=%v", visible, err)
		}
		resolved, err := postgres.ResolveDiscoveryContentTarget(ctx, db, "marketing-market-store-content", city)
		if err != nil || resolved.StoreID != "marketing-market-store" {
			t.Fatalf("legitimate market product target is inaccessible: %+v err=%v", resolved, err)
		}
		if result, err := postgres.ResolveDiscoveryContentTarget(ctx, db, "marketing-independent-store-content", city); !errors.Is(err, postgres.ErrDiscoveryContentNotFound) {
			t.Fatalf("marketplace exposed an independent product target: %+v error=%v", result, err)
		}
		list, err := postgres.ListDiscoveryContent(ctx, db, true, city)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range list {
			if item.ID == "marketing-independent-store-content" {
				t.Fatal("independent Store target entered global marketplace discovery content")
			}
		}
	})
}
