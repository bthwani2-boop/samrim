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

// This test can only create and drop an isolated disposable test database.
// Never run it against a live application database.
func TestCatalogInventorySummaryCountsEveryOfferAndIsolatesStores(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, uri, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		for _, stmt := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('inv-city','Test City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('inv-vertical','Inventory','Inventory')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('inv-type','inv-vertical','Retail','Retail')",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('inv-store-a','inv-owner-a','Inventory Store A','inv-city','inv-vertical','inv-type','unpublished',ARRAY['CUSTOMER_PICKUP'])",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('inv-store-b','inv-owner-b','Inventory Store B','inv-city','inv-vertical','inv-type','unpublished',ARRAY['CUSTOMER_PICKUP'])",
			"INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name,active) VALUES('inv-product','inv-vertical','SHARED','Inventory Test',true)",
			"INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit,active) SELECT 'inv-variant-'||n::text,'inv-product','Variant '||n::text,'DISCRETE','COUNT',true FROM generate_series(1,130) n",
			"INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,pricing_basis,pricing_unit_base_units,inventory_policy,inventory_on_hand_base_units,publication_state,availability) SELECT 'inv-offer-'||n::text,'inv-store-a','inv-variant-'||n::text,1500,'DISCRETE','PER_UNIT',1,CASE WHEN n<=4 THEN 'QUANTITY_ON_HAND' ELSE 'AVAILABILITY_ONLY' END,0,CASE WHEN n<=127 THEN 'published' ELSE 'draft' END,NOT (n BETWEEN 5 AND 9) FROM generate_series(1,130) n",
			"INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,pricing_basis,pricing_unit_base_units,publication_state,availability) VALUES('inv-offer-b','inv-store-b','inv-variant-1',1500,'DISCRETE','PER_UNIT',1,'published',true)",
		} {
			if _, err := db.ExecContext(ctx, stmt); err != nil {
				t.Fatalf("fixture SQL: %v", err)
			}
		}
		first, err := postgres.ReadCatalogInventorySummary(ctx, db, "inv-store-a")
		if err != nil {
			t.Fatal(err)
		}
		if first.TotalOffers != 130 || first.PublishedOffers != 127 || first.AvailableOffers != 118 || first.UnavailableOffers != 9 || first.StockoutOffers != 4 {
			t.Fatalf("whole-Store inventory is wrong: %+v", first)
		}
		second, err := postgres.ReadCatalogInventorySummary(ctx, db, "inv-store-b")
		if err != nil {
			t.Fatal(err)
		}
		if second.TotalOffers != 1 || second.AvailableOffers != 1 || second.StockoutOffers != 0 {
			t.Fatalf("cross-Store inventory leak: %+v", second)
		}
		if _, err = postgres.ReadCatalogInventorySummary(ctx, db, "inv-missing"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("missing Store must fail closed: %v", err)
		}
	})
}
