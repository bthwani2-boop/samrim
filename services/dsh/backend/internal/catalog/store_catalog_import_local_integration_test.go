package catalog

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestStoreImportUnbarcodedProductCreatesOneLocalProductAndOffer(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL needed for isolated Store import proof")
	}
	admin, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	databaseName := fmt.Sprintf("dsh_storeimport_proof_%d", time.Now().UnixNano())
	if _, err = admin.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanCtx, cleanCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanCancel()
		if _, dropErr := admin.ExecContext(cleanCtx, "DROP DATABASE IF EXISTS "+databaseName+" WITH (FORCE)"); dropErr != nil {
			t.Errorf("cleanup isolated Store import: %v", dropErr)
		}
	})
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + databaseName
	db, err := sql.Open("postgres", parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	records, sqlText, err := postgres.LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	keys, err := postgres.NewDeliveryProofKeyring("test-v1", map[string]string{"test-v1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="})
	if err != nil {
		t.Fatal(err)
	}
	if err = postgres.Migrate(ctx, db, records, sqlText, keys); err != nil {
		t.Fatalf("migrate fresh import test database: %v", err)
	}
	if err = postgres.VerifySchema(ctx, db, records); err != nil {
		t.Fatal(err)
	}
	const cityID = "import-local-city"
	const verticalID = "import-local-food"
	const storeType = "import-local-restaurant"
	const storeID = "store-import-local"
	const actorID = "operator-import-local"
	if _, err = db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar) VALUES($1,$2)", cityID, "مدينة اختبار الاستيراد"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,$2,$3)", verticalID, "مطاعم الاختبار", "Test Restaurants"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES($1,$2,$3,$4)", storeType, verticalID, "مطعم", "Restaurant"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,fulfillment_modes) VALUES($1,$2,$3,$4,$5,$6,$7)", storeID, "partner-import-local", "مطعم المراجعة", cityID, verticalID, storeType, "{BTHWANI_CAPTAIN}"); err != nil {
		t.Fatal(err)
	}
	service := &Service{db: db}
	file := []byte("اسم المنتج,السعر\nبيتزا محلية,2500\n")
	preview, err := service.previewStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, "", "menu.csv", file, "menu-local-preview-1", "menu-local-corr-1")
	if err != nil || len(preview.Items) != 1 || preview.Items[0].Classification != "READY" || preview.Items[0].StoreOfferInput == nil || preview.Items[0].StoreOfferInput.NewProduct == nil {
		t.Fatalf("new local Product preview: %+v err=%v", preview, err)
	}
	committed, err := service.commitStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, preview.Run.ID, "menu-local-commit-1", "menu-local-corr-2")
	if err != nil || len(committed.Items) != 1 || committed.Items[0].Classification != "IMPORTED" {
		t.Fatalf("new local Product and offer commit: %+v err=%v", committed, err)
	}
	imported := committed.Items[0]
	if imported.ProductID == nil || imported.VariantID == nil {
		t.Fatalf("import lacks canonical Product/Variant readback: %+v", imported)
	}
	product, err := postgres.ReadCatalogProduct(ctx, db, *imported.ProductID)
	if err != nil || product.Scope != "STORE_SCOPED" || product.StoreID != storeID || product.CanonicalName != "بيتزا محلية" {
		t.Fatalf("created Product ownership: %+v err=%v", product, err)
	}
	var offerCount int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.catalog_store_offers WHERE store_id=$1 AND variant_id=$2 AND price_minor=2500", storeID, *imported.VariantID).Scan(&offerCount); err != nil || offerCount != 1 {
		t.Fatalf("expected exactly one local offer at 2500: count=%d err=%v", offerCount, err)
	}
	replay, err := service.commitStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, preview.Run.ID, "menu-local-commit-1", "menu-local-corr-replay")
	if err != nil || len(replay.Items) != 1 || replay.Items[0].ProductID == nil || *replay.Items[0].ProductID != *imported.ProductID {
		t.Fatalf("committed import replay duplicated Product: %+v err=%v", replay, err)
	}
	duplicate, err := service.previewStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, "", "menu.csv", file, "menu-local-preview-2", "menu-local-corr-3")
	if err != nil || len(duplicate.Items) != 1 || duplicate.Items[0].Classification != "DUPLICATE_EXISTING" {
		t.Fatalf("repeat file must not create another Product: %+v err=%v", duplicate, err)
	}

	sameNameNewVariant := []byte("اسم المنتج,النسخة,السعر\nبيتزا محلية,صغير,2000\n")
	variantDuplicate, err := service.previewStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, "", "variant.csv", sameNameNewVariant, "menu-variant-preview", "menu-variant-corr")
	if err != nil || len(variantDuplicate.Items) != 1 || variantDuplicate.Items[0].Classification != "DUPLICATE_EXISTING" {
		t.Fatalf("same Store Product name with a different variant must not fork Product identity: %+v err=%v", variantDuplicate, err)
	}
	staleFile := []byte("اسم المنتج,السعر\nفطيرة تجربة,800\n")
	stalePreview, err := service.previewStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, "", "stale.csv", staleFile, "menu-stale-preview", "menu-stale-corr")
	if err != nil || len(stalePreview.Items) != 1 || stalePreview.Items[0].Classification != "READY" {
		t.Fatalf("pre-collision preview: %+v err=%v", stalePreview, err)
	}
	concurrentProduct := postgres.CatalogProductInput{VerticalID: verticalID, StoreID: storeID, Scope: "STORE_SCOPED", CanonicalName: "فطيرة تجربة", VariantTitle: "الافتراضي", MeasurementKind: "DISCRETE", BaseUnit: "COUNT"}
	if _, err = postgres.CreateCatalogProduct(ctx, db, concurrentProduct, "other-writer-local-product", postgres.HashCatalogProductCreateRequest(concurrentProduct), actorID, "other-writer-corr"); err != nil {
		t.Fatalf("insert competing canonical Product after preview: %v", err)
	}
	staleResult, err := service.commitStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, stalePreview.Run.ID, "menu-stale-commit", "menu-stale-commit-corr")
	if err != nil || len(staleResult.Items) != 1 || staleResult.Items[0].Classification != "FAILED" {
		t.Fatalf("stale preview must fail closed rather than duplicate: %+v err=%v", staleResult, err)
	}
	var staleCount int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.catalog_products WHERE store_id=$1 AND canonical_name=$2", storeID, "فطيرة تجربة").Scan(&staleCount); err != nil || staleCount != 1 {
		t.Fatalf("stale preview duplicated Store Product: count=%d err=%v", staleCount, err)
	}
	measuredFile := []byte("اسم المنتج,الوحدة,السعر\nعصير فراولة,ملليلتر,900\n")
	measuredPreview, err := service.previewStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, "", "measured.csv", measuredFile, "menu-measured-preview", "menu-measured-corr-1")
	if err != nil || len(measuredPreview.Items) != 1 || measuredPreview.Items[0].Classification != "READY" {
		t.Fatalf("measured preview: %+v err=%v", measuredPreview, err)
	}
	measuredResult, err := service.commitStoreCatalogImport(ctx, actorID, "OPERATOR", storeID, measuredPreview.Run.ID, "menu-measured-commit", "menu-measured-corr-2")
	if err != nil || len(measuredResult.Items) != 1 || measuredResult.Items[0].Classification != "IMPORTED" {
		t.Fatalf("measured commit: %+v err=%v", measuredResult, err)
	}
	if measuredResult.Items[0].VariantID == nil {
		t.Fatalf("measured variant missing: %+v", measuredResult.Items[0])
	}
	var pricingBasis, quantityPolicy string
	if err = db.QueryRowContext(ctx, "SELECT pricing_basis,quantity_policy FROM dsh.catalog_store_offers WHERE store_id=$1 AND variant_id=$2", storeID, *measuredResult.Items[0].VariantID).Scan(&pricingBasis, &quantityPolicy); err != nil || pricingBasis != "PER_MEASURE" || quantityPolicy != "MEASURED" {
		t.Fatalf("measured offer semantics basis=%s quantity=%s err=%v", pricingBasis, quantityPolicy, err)
	}

}
