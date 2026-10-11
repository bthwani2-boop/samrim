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
)

func TestCatalogTrashPreservesProductsAndHidesActiveReads(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL required for isolated catalog trash integration proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	for attempt := 0; attempt < 20; attempt++ {
		err = rootDB.PingContext(ctx)
		if err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		var viewSQL string
		if err := db.QueryRowContext(ctx, "SELECT pg_get_viewdef('dsh.catalog_publishable_offers'::regclass, true)").Scan(&viewSQL); err != nil || !strings.Contains(viewSQL, "deleted_at IS NULL") {
			t.Fatalf("published catalog view does not exclude deleted products: %v %s", err, viewSQL)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES ('trash_vertical','خضروات','Vegetables')"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name,active) VALUES ('trash_product_1','trash_vertical','SHARED','منتج للاختبار',true)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit,active) VALUES ('trash_variant_1','trash_product_1','الافتراضي','DISCRETE','COUNT',true)"); err != nil {
			t.Fatal(err)
		}
		before, err := postgres.ReadCatalogProduct(ctx, db, "trash_product_1")
		if err != nil || before.Version != 1 {
			t.Fatalf("original product: %+v %v", before, err)
		}
		page, err := postgres.ListCatalogProductRegistry(ctx, db, "", "", "", "all", "name_asc", 10, "")
		if err != nil || len(page.Products) != 1 {
			t.Fatalf("initial registry: %+v %v", page, err)
		}
		item, replay, err := postgres.SetCatalogProductTrashed(ctx, db, before.ID, "operator-test", "إزالة منتج تجريبي بأمان", "trash", "trash-request-key-0001", before.Version)
		if err != nil || replay || item.DeletedAt == nil || item.Version != 2 {
			t.Fatalf("trash: %+v replay=%v err=%v", item, replay, err)
		}
		again, replay, err := postgres.SetCatalogProductTrashed(ctx, db, before.ID, "operator-test", "إزالة منتج تجريبي بأمان", "trash", "trash-request-key-0001", before.Version)
		if err != nil || !replay || again.Version != 2 {
			t.Fatalf("idempotent trash: %+v replay=%v err=%v", again, replay, err)
		}
		if _, _, err := postgres.SetCatalogProductTrashed(ctx, db, before.ID, "operator-test", "طلب مختلف تمامًا", "trash", "trash-request-key-0001", before.Version); !errors.Is(err, postgres.ErrCatalogIdempotencyConflict) {
			t.Fatalf("reused key with different payload: %v", err)
		}
		if _, _, err := postgres.SetCatalogProductTrashed(ctx, db, before.ID, "operator-test", "", "restore", "restore-stale-0001", 1); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
			t.Fatalf("stale restore version: %v", err)
		}
		if _, err := postgres.ReadCatalogProduct(ctx, db, before.ID); !errors.Is(err, postgres.ErrCatalogProductNotFound) {
			t.Fatalf("deleted read must fail: %v", err)
		}
		page, err = postgres.ListCatalogProductRegistry(ctx, db, "", "", "", "all", "name_asc", 10, "")
		if err != nil || len(page.Products) != 0 {
			t.Fatalf("deleted product leaked to registry: %+v err=%v", page, err)
		}
		trash, err := postgres.ListDeletedCatalogProducts(ctx, db, 10, "")
		if err != nil || len(trash.Products) != 1 || trash.Products[0].ID != before.ID {
			t.Fatalf("trash list: %+v err=%v", trash, err)
		}
		if _, err := postgres.ListDeletedCatalogProducts(ctx, db, 10, "not-base64"); !errors.Is(err, postgres.ErrCatalogTrashInvalid) {
			t.Fatalf("malformed cursor: %v", err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_product_variants WHERE product_id=$1", before.ID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("variant removed: %d err=%v", count, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_product_trash_audit WHERE product_id=$1", before.ID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("audit missing: %d err=%v", count, err)
		}
		restored, replay, err := postgres.SetCatalogProductTrashed(ctx, db, before.ID, "operator-test", "", "restore", "restore-request-0001", 2)
		if err != nil || replay || restored.DeletedAt != nil || restored.Version != 3 {
			t.Fatalf("restore: %+v replay=%v err=%v", restored, replay, err)
		}
		if _, err := postgres.ReadCatalogProduct(ctx, db, before.ID); err != nil {
			t.Fatalf("restored product missing: %v", err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_product_trash_audit WHERE product_id=$1", before.ID).Scan(&count); err != nil || count != 2 {
			t.Fatalf("restore audit missing: %d err=%v", count, err)
		}
	})
}
