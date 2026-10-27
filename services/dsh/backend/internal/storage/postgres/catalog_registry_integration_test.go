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

func TestCatalogProductRegistryServerFiltersAndCountSortPagination(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, uri, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const verticalID = "registry-scale-vertical"
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,'Registry Test','Registry Test')`, verticalID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_categories(id,vertical_id,name_ar,name_en,active) VALUES('registry-scale-category',$1,'Registry Test','Registry Test',true)`, verticalID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name,active,version)
			SELECT 'registry-scale-'||lpad(n::text,5,'0'),$1,'SHARED','Registry product '||lpad(n::text,5,'0'),true,1 FROM generate_series(1,10000) n`, verticalID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit,active,version)
			SELECT 'registry-scale-v'||lpad(n::text,5,'0'),'registry-scale-'||lpad(n::text,5,'0'),'Default','DISCRETE','COUNT',true,1 FROM generate_series(1,10000) n`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name,active,version) VALUES('registry-scale-tail',$1,'SHARED','ZZZ registry tail match',true,1)`, verticalID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit,active,version)
			SELECT 'registry-scale-tail-v'||n::text,'registry-scale-tail','Variant '||n::text,'DISCRETE','COUNT',true,1 FROM generate_series(1,4) n`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_categories(product_id,category_id) VALUES('registry-scale-tail','registry-scale-category')`); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('registry-scale-city','Registry Test',true)`); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "registry-scale-store-a", PartnerActorID: "registry-scale-owner-a", Name: "Registry Test A", ServiceCityID: "registry-scale-city", PrimaryVerticalID: verticalID, PublicationState: "published"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "registry-scale-store-b", PartnerActorID: "registry-scale-owner-b", Name: "Registry Test B", ServiceCityID: "registry-scale-city", PrimaryVerticalID: verticalID, PublicationState: "published"})
		createProduct := func(id, name string) postgres.CatalogProductResult {
			t.Helper()
			input := postgres.CatalogProductInput{VerticalID: verticalID, Scope: "SHARED", CanonicalName: name, VariantTitle: "Default", MeasurementKind: "DISCRETE", BaseUnit: "COUNT", CategoryIDs: []string{"registry-scale-category"}}
			created, err := postgres.CreateCatalogProduct(ctx, db, input, id+"-create", postgres.HashCatalogProductCreateRequest(input), "registry-scale-operator", id+"-correlation")
			if err != nil {
				t.Fatalf("create fixture Product %s: %v", id, err)
			}
			return created
		}
		createVisibleOffer := func(storeID, offerID string, variant postgres.CatalogVariantRecord) {
			t.Helper()
			input := postgres.CatalogOfferInput{StoreID: storeID, VariantID: variant.ID, PriceMinor: 350, QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY"}
			offer, err := postgres.CreateCatalogOffer(ctx, db, input, offerID+"-create", postgres.HashCatalogOfferCreateRequest(input), "registry-scale-operator", offerID+"-correlation")
			if err != nil {
				t.Fatalf("create fixture StoreOffer %s: %v", offerID, err)
			}
			if _, err := db.ExecContext(ctx, `UPDATE dsh.catalog_store_offers SET publication_state='published',availability=true WHERE id=$1`, offer.Offer.ID); err != nil {
				t.Fatal(err)
			}
		}
		oneStoreProduct := createProduct("registry-one-store", "Registry One Store")
		createVisibleOffer("registry-scale-store-a", "registry-one-store-offer", oneStoreProduct.Product.Variants[0])
		twoStoreProduct := createProduct("registry-two-stores", "Registry Two Stores")
		createVisibleOffer("registry-scale-store-a", "registry-two-store-offer-a", twoStoreProduct.Product.Variants[0])
		createVisibleOffer("registry-scale-store-b", "registry-two-store-offer-b", twoStoreProduct.Product.Variants[0])

		page, err := postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 4, 0, "name_asc", 50, "")
		if err != nil || page.TotalCount != 1 || len(page.Products) != 1 || page.Products[0].ID != "registry-scale-tail" {
			t.Fatalf("server min variant filter missed the match beyond the first 50: total=%d products=%+v err=%v", page.TotalCount, page.Products, err)
		}
		page, err = postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 0, 2, "stores_desc", 50, "")
		if err != nil || page.TotalCount != 1 || len(page.Products) != 1 || page.Products[0].ID != twoStoreProduct.Product.ID || page.Products[0].StoreCount != 2 {
			t.Fatalf("server min store filter/readback mismatch: total=%d products=%+v err=%v", page.TotalCount, page.Products, err)
		}
		page, err = postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 0, 1, "stores_desc", 1, "")
		if err != nil || len(page.Products) != 1 || page.Products[0].ID != twoStoreProduct.Product.ID || page.NextCursor == "" {
			t.Fatalf("store count descending order or cursor missing: %+v err=%v", page, err)
		}
		second, err := postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 0, 1, "stores_desc", 1, page.NextCursor)
		if err != nil || len(second.Products) != 1 || second.Products[0].ID != oneStoreProduct.Product.ID {
			t.Fatalf("store count pagination did not continue to the one-store product: %+v err=%v", second, err)
		}
		if _, err := postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 1, 1, "stores_desc", 1, page.NextCursor); !errors.Is(err, postgres.ErrCatalogProductRegistryInvalidCursor) {
			t.Fatalf("cursor reused with changed filters: %v", err)
		}
		ascending, err := postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 0, 0, "variants_asc", 1, "")
		if err != nil || len(ascending.Products) != 1 || ascending.NextCursor == "" {
			t.Fatalf("variant count ascending page failed: %+v err=%v", ascending, err)
		}
		ascendingNext, err := postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 0, 0, "variants_asc", 1, ascending.NextCursor)
		if err != nil || len(ascendingNext.Products) != 1 || ascendingNext.Products[0].ID <= ascending.Products[0].ID {
			t.Fatalf("variant count ascending tie-break was not stable: first=%+v second=%+v err=%v", ascending.Products, ascendingNext.Products, err)
		}
		descending, err := postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 0, 0, "variants_desc", 1, "")
		if err != nil || len(descending.Products) != 1 || descending.Products[0].ID != "registry-scale-tail" {
			t.Fatalf("variant count descending order missed the largest count: %+v err=%v", descending, err)
		}
		if _, err := postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", -1, 0, "name_asc", 50, ""); !errors.Is(err, postgres.ErrCatalogProductRegistryInvalidCursor) {
			t.Fatalf("negative minVariantCount accepted: %v", err)
		}
		if _, err := postgres.ListCatalogProductRegistry(ctx, db, "", verticalID, "", "all", 0, 0, "invalid", 50, ""); !errors.Is(err, postgres.ErrCatalogProductRegistryInvalidCursor) {
			t.Fatalf("invalid count sort accepted: %v", err)
		}
	})
}
