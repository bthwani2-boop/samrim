package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Prove the canonical paged customer Store query at the planned initial size.
// Fixtures live only inside withFreshDatabase and never enter local business data.
func TestPublishedStoreDiscoveryScaleHundredTwenty(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("isolated PostgreSQL URL required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	if err = root.Ping(); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		migrationStarted := time.Now()
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		t.Logf("isolated migration: %s", time.Since(migrationStarted))
		for _, statement := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar) VALUES('scale_city','مدينة اختبار الحجم')",
			"INSERT INTO dsh.service_cities(id,display_name_ar) VALUES('other_scale_city','مدينة أخرى')",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('scale_vertical','مجال الحجم','Scale')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('scale_type','scale_vertical','نوع الحجم','Scale Type')",
			"INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name,active) VALUES('scale_product','scale_vertical','SHARED','منتج اختبار الحجم',true)",
			"INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit,active) VALUES('scale_variant','scale_product','واحد','DISCRETE','COUNT',true)",
			"INSERT INTO dsh.catalog_categories(id,vertical_id,name_ar,name_en,active) VALUES('scale_category','scale_vertical','قسم اختبار الحجم','Scale Category',true)",
			"INSERT INTO dsh.catalog_product_categories(product_id,category_id) VALUES('scale_product','scale_category')",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,publication_changed_at) SELECT 'scale_store_'||n,'scale_partner','متجر اختبار '||lpad(n::text,3,'0'),'scale_city','scale_vertical','scale_type','published',clock_timestamp() FROM generate_series(1,120) n",
			"INSERT INTO dsh.joining_cases(id,contact_phone_e164,business_name,first_store_name,first_store_vertical_id,first_store_commercial_type_id,partner_actor_id,state,store_id,origin,financial_profile_state) VALUES('scale_joining','+967770099992','مؤسسة اختبار الحجم','متجر اختبار 001','scale_vertical','scale_type','scale_partner','approved','scale_store_1','control_panel','ACTIVE')",
			"INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_basis,pricing_unit_base_units,inventory_policy,availability,publication_state) SELECT 'scale_offer_'||n,'scale_store_'||n,'scale_variant',1000+n,'DISCRETE',1,100,1,'PER_UNIT',1,'AVAILABILITY_ONLY',true,'published' FROM generate_series(1,120) n",
		} {
			if _, err := db.ExecContext(ctx, statement); err != nil {
				t.Fatalf("isolated Store fixtures: %v", err)
			}
		}
		seen := make(map[string]bool, 120)
		cursor := ""
		pages := 0
		started := time.Now()
		for {
			page, err := postgres.ListPublishedStorePage(ctx, db, postgres.PublicStoreListQuery{ServiceCityID: "scale_city", Sort: "newest", Limit: 40, Cursor: cursor})
			if err != nil {
				t.Fatalf("page %d: %v", pages+1, err)
			}
			if len(page.Stores) > 40 {
				t.Fatalf("unbounded public page %d: %d", pages, len(page.Stores))
			}
			for _, store := range page.Stores {
				if seen[store.ID] {
					t.Fatalf("duplicate Store across pages: %s", store.ID)
				}
				seen[store.ID] = true
			}
			pages++
			if page.NextCursor == "" {
				break
			}
			if page.NextCursor == cursor || pages > 5 {
				t.Fatal("pagination cursor did not progress")
			}
			cursor = page.NextCursor
		}
		if len(seen) != 120 || pages != 3 {
			t.Fatalf("120 public Stores should occupy three pages: got %d stores, %d pages", len(seen), pages)
		}
		first, err := postgres.ReadPublishedStore(ctx, db, "scale_store_1", "scale_city")
		if err != nil || first.ID != "scale_store_1" {
			t.Fatalf("customer Store detail readback: %+v err=%v", first, err)
		}
		catalog, err := postgres.ReadPublicCatalog(ctx, db, "scale_store_1", "scale_city", "", "", "", 10, "")
		if err != nil || len(catalog.Offers) != 1 {
			t.Fatalf("customer Store catalog readback: %+v err=%v", catalog, err)
		}
		otherCity, err := postgres.ListPublishedStorePage(ctx, db, postgres.PublicStoreListQuery{ServiceCityID: "other_scale_city", Limit: 40})
		if err != nil || len(otherCity.Stores) != 0 {
			t.Fatalf("public Store city scope leak: %+v err=%v", otherCity, err)
		}
		t.Log(fmt.Sprintf("PUBLIC_STORE_SCALE stores=%d pages=%d elapsed=%s customer_detail=true catalog_offer=true", len(seen), pages, time.Since(started)))
	}, 90*time.Second)
}
