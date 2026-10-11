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

func TestCatalogCategoryTrashPreservesTaxonomyHistory(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("requires isolated DSH_DATABASE_URL")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	for i := 0; i < 20; i++ {
		err = root.PingContext(ctx)
		if err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, scripts []string) {
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('trash_cat_vertical','متاجر','Stores')"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_categories(id,vertical_id,name_ar,name_en) VALUES('trash_parent','trash_cat_vertical','القسم الرئيسي','Main'),('trash_leaf','trash_cat_vertical','الفرعي','Leaf')"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.catalog_categories SET parent_category_id='trash_parent' WHERE id='trash_leaf'"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name) VALUES('trash_cat_product','trash_cat_vertical','SHARED','منتج محفوظ')"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_product_categories(product_id,category_id) VALUES ('trash_cat_product','trash_leaf')"); err != nil {
			t.Fatal(err)
		}
		if _, _, err := postgres.SetCatalogCategoryTrashed(ctx, db, "trash_parent", "actor-operator", "حذف القسم الرئيسي", "trash", "parent-cat-trash-0001", 1); !errors.Is(err, postgres.ErrCatalogCategoryTrashHasChildren) {
			t.Fatalf("parent with child deletion not blocked: %v", err)
		}
		deleted, replay, err := postgres.SetCatalogCategoryTrashed(ctx, db, "trash_leaf", "actor-operator", "فئة تجريبية غير مطلوبة", "trash", "leaf-cat-trash-0001", 1)
		if err != nil || replay || deleted.Version != 2 || deleted.DeletedAt == nil {
			t.Fatalf("delete leaf: %+v %v %v", deleted, replay, err)
		}
		again, replay, err := postgres.SetCatalogCategoryTrashed(ctx, db, "trash_leaf", "actor-operator", "فئة تجريبية غير مطلوبة", "trash", "leaf-cat-trash-0001", 1)
		if err != nil || !replay || again.Version != 2 {
			t.Fatalf("duplicate: %+v %v %v", again, replay, err)
		}
		page, err := postgres.ListDeletedCatalogCategories(ctx, db, 10, "")
		if err != nil || len(page.Categories) != 1 || page.Categories[0].ID != "trash_leaf" {
			t.Fatalf("trash listing: %+v %v", page, err)
		}
		active, err := postgres.ListCatalogCategoryPage(ctx, db, "trash_cat_vertical", "", "active", "name_asc", 10, "")
		if err != nil || len(active.Categories) != 1 || active.Categories[0].ID != "trash_parent" {
			t.Fatalf("deleted category leaked into active: %+v %v", active, err)
		}
		if _, err := postgres.ReadCatalogCategoryForRegistry(ctx, db, "trash_leaf"); !errors.Is(err, postgres.ErrCatalogCategoryNotFound) {
			t.Fatalf("deleted category registry read: %v", err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_product_categories WHERE product_id='trash_cat_product' AND category_id='trash_leaf'").Scan(&count); err != nil || count != 1 {
			t.Fatalf("product association removed: %d %v", count, err)
		}
		if _, _, err := postgres.SetCatalogCategoryTrashed(ctx, db, "trash_leaf", "actor-operator", "", "restore", "leaf-cat-stale-0001", 1); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
			t.Fatalf("stale restoration: %v", err)
		}
		restored, replay, err := postgres.SetCatalogCategoryTrashed(ctx, db, "trash_leaf", "actor-operator", "", "restore", "leaf-cat-restore-0001", 2)
		if err != nil || replay || restored.Version != 3 {
			t.Fatalf("restore: %+v %v %v", restored, replay, err)
		}
		var enabled bool
		var deletedAt sql.NullTime
		if err := db.QueryRowContext(ctx, "SELECT active,deleted_at FROM dsh.catalog_categories WHERE id='trash_leaf'").Scan(&enabled, &deletedAt); err != nil || enabled || deletedAt.Valid {
			t.Fatalf("restore should remain inactive: active=%v deleted=%v err=%v", enabled, deletedAt, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_category_trash_audit WHERE category_id='trash_leaf'").Scan(&count); err != nil || count != 2 {
			t.Fatalf("category audit: %d %v", count, err)
		}
	})
}
