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

// A marketplace Client share must never turn merchant-direct content into a
// marketplace resource. All deliberately inconsistent rows live only inside
// the disposable database created by withFreshDatabase.
func TestClientShareRejectsIndependentStorePromotionsAndContent(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL is required for marketplace share isolation proof")
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
		const city = "share-relation-city"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'مدينة اختبار',true)", city); err != nil {
			t.Fatal(err)
		}
		for _, store := range []string{"share-market-store", "share-independent-store"} {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
				ID: store, PartnerActorID: store + "-owner", Name: store, ServiceCityID: city, PublicationState: "published",
			})
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_products(id,canonical_name,scope,vertical_id,store_id)
				VALUES($1,'منتج مشاركة','STORE_SCOPED',$2,$3)`, store+"-product", store+"-vertical", store); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit)
				VALUES($1,$2,'قطعة','DISCRETE','COUNT')`, store+"-variant", store+"-product"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,pricing_basis,
				pricing_unit_base_units,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,inventory_policy,
				publication_state,availability)
				VALUES($1,$2,$3,1200,'DISCRETE','PER_UNIT',1,1,10,1,'AVAILABILITY_ONLY','published',true)`,
				store+"-offer", store, store+"-variant"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_promotions
				(id,code,name_ar,kind,value_minor,starts_at,ends_at,created_by_actor_id,store_id,funding_source,state)
				VALUES($1,$2,'عرض تجربة','FIXED',50,now()-interval '1 hour',now()+interval '1 day','proof-actor',$3,'PARTNER','PUBLISHED')`,
				store+"-promotion", strings.ToUpper(strings.ReplaceAll(store, "-", "")), store); err != nil {
				t.Fatal(err)
			}
		}
		type fixture struct{ id, kind, target, source string }
		for _, value := range []fixture{
			{"share-market-banner", "STORE", "share-market-store", "share-market-store"},
			{"share-independent-banner", "STORE", "share-independent-store", "share-independent-store"},
			{"share-independent-platform-target", "STORE", "share-independent-store", ""},
			{"share-market-product-content", "PRODUCT", "share-market-store-product", ""},
			{"share-independent-product-content", "PRODUCT", "share-independent-store-product", ""},
			{"share-platform-info-content", "INFO", "", ""},
		} {
			asset := value.id + "-asset"
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets
				(id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
				 state,creator,source_description,rights_statement,rights_attested_by_actor_id)
				VALUES($1,$2,$3,$4,$5,$6,'image/png',128,'active','Test owner','Source','Rights','test-actor')`,
				asset, asset+"-idem", postgres.HashMarketingFacts(asset), "proof/"+asset,
				"asset://"+asset, strings.Repeat("a", 64)); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content
				(id,kind,title_ar,media_asset_id,target_type,target_id,source_store_id,service_city_id,state,starts_at,ends_at,created_by_actor_id,partner_enabled)
				VALUES($1,'BANNER','بنر مشاركة',$2,$3,NULLIF($4,''),NULLIF($5,''),$6,'PUBLISHED',
					now()-interval '1 hour',now()+interval '1 day','test-actor',true)`,
				value.id, asset, value.kind, value.target, value.source, city); err != nil {
				t.Fatalf("content fixture %s: %v", value.id, err)
			}
		}
		if _, err := db.ExecContext(ctx, "ALTER TABLE dsh.stores DROP CONSTRAINT stores_independent_market_publication_chk"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE' WHERE id='share-independent-store'`); err != nil {
			t.Fatal(err)
		}
		for _, tc := range []struct {
			kind, id string
			allowed  bool
		}{
			{"STORE", "share-market-store", true},
			{"STORE", "share-independent-store", false},
			{"OFFER", "share-market-store-offer", true},
			{"OFFER", "share-independent-store-offer", false},
			{"PROMOTION", "share-market-store-promotion", true},
			{"PROMOTION", "share-independent-store-promotion", false},
			{"CONTENT", "share-market-banner", true},
			{"CONTENT", "share-independent-banner", false},
			{"CONTENT", "share-independent-platform-target", false},
			{"CONTENT", "share-market-product-content", true},
			{"CONTENT", "share-independent-product-content", false},
			{"CONTENT", "share-platform-info-content", true},
		} {
			t.Run(tc.kind+"-"+tc.id, func(t *testing.T) {
				// No recipient means a generic acknowledgment with no delivery,
				// but it still takes the same canonical target eligibility gate.
				err := postgres.SendClientShare(ctx, db, "share-fixture-unregistered", "", "+967771234567", tc.kind, tc.id, "LOOK", "eligibility-check")
				if (tc.allowed && err != nil) || (!tc.allowed && !errors.Is(err, postgres.ErrClientShareInvalid)) {
					t.Fatalf("share eligibility kind=%s resource=%s allowed=%v err=%v", tc.kind, tc.id, tc.allowed, err)
				}
			})
		}

		const sender = "share-fixture-sender"
		const recipient = "share-fixture-recipient"
		const phone = "+967771234567"
		const offerID = "share-market-store-offer"
		const idempotencyKey = "visible-offer-share"
		for _, target := range []string{"", sender} {
			if err := postgres.SendClientShare(ctx, db, sender, target, phone, "OFFER", offerID, "LOOK", "unresolved-recipient"); err != nil {
				t.Fatalf("non-delivering recipient must receive generic acknowledgment: %v", err)
			}
		}
		if err := postgres.SendClientShare(ctx, db, sender, recipient, phone, "OFFER", offerID, "LOOK", idempotencyKey); err != nil {
			t.Fatal(err)
		}
		visible, err := postgres.ListClientShares(ctx, db, recipient, 0, 50)
		if err != nil || visible.UnreadCount != 1 || len(visible.Items) != 1 ||
			visible.Items[0].ContentTitle != "منتج مشاركة" || visible.Items[0].StoreID != "share-market-store" ||
			visible.Items[0].ProductID != "share-market-store-product" {
			t.Fatalf("canonical visible offer was not readable in the recipient inbox: %+v, %v", visible, err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.catalog_products SET active=false,canonical_name='Private replacement title'
			WHERE id='share-market-store-product'`); err != nil {
			t.Fatal(err)
		}
		withdrawn, err := postgres.ListClientShares(ctx, db, recipient, 0, 50)
		if err != nil || withdrawn.UnreadCount != 1 || len(withdrawn.Items) != 1 ||
			withdrawn.Items[0].ID != visible.Items[0].ID || withdrawn.Items[0].ContentID != offerID ||
			withdrawn.Items[0].ContentTitle != "" || withdrawn.Items[0].StoreID != "" || withdrawn.Items[0].ProductID != "" {
			t.Errorf("withdrawn offer must retain the receipt without private metadata: %+v, %v", withdrawn, err)
		}
		if err := postgres.SendClientShare(ctx, db, sender, recipient, phone, "OFFER", offerID, "LOOK", idempotencyKey); err != nil {
			t.Errorf("exact receipt replay must survive withdrawal: %v", err)
		}
		if err := postgres.SendClientShare(ctx, db, sender, recipient, phone, "OFFER", offerID, "TRY", idempotencyKey); !errors.Is(err, postgres.ErrClientShareConflict) {
			t.Errorf("reusing the receipt key with a different request must conflict: %v", err)
		}
		if err := postgres.SendClientShare(ctx, db, sender, recipient, phone, "OFFER", offerID, "LOOK", "new-withdrawn-share"); !errors.Is(err, postgres.ErrClientShareInvalid) {
			t.Errorf("writer must refuse a fresh share for the withdrawn offer: %v", err)
		}
		if err := postgres.MarkClientShareRead(ctx, db, sender, visible.Items[0].ID); !errors.Is(err, postgres.ErrClientShareNotFound) {
			t.Errorf("sender must not change recipient receipt: %v", err)
		}
		if err := postgres.MarkClientShareRead(ctx, db, recipient, visible.Items[0].ID); err != nil {
			t.Errorf("recipient could not read their historical receipt: %v", err)
		}
		if err := postgres.BlockClientShareSender(ctx, db, recipient, sender, true); err != nil {
			t.Fatal(err)
		}
		if err := postgres.SendClientShare(ctx, db, sender, recipient, phone, "STORE", "share-market-store", "LOOK", "blocked-share"); err != nil {
			t.Errorf("blocked recipient must receive generic acknowledgment: %v", err)
		}
		other, err := postgres.ListClientShares(ctx, db, sender, 0, 50)
		if err != nil || other.UnreadCount != 0 || len(other.Items) != 0 {
			t.Errorf("sender must not read recipient inbox or receive self shares: %+v, %v", other, err)
		}
		final, err := postgres.ListClientShares(ctx, db, recipient, 0, 50)
		if err != nil || final.UnreadCount != 0 || len(final.Items) != 1 || final.Items[0].ReadAt == nil {
			t.Errorf("receipt readback must show exactly one read share: %+v, %v", final, err)
		}
	})
}
