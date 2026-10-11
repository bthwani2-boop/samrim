package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestCatalogTrashUpgradePreservesExistingProducts(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
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
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqlMigrations []string) {
		if err := applyMigrationPrefix(ctx, db, records, sqlMigrations, 110); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES ('trash_legacy_vertical','مجال تجريبي','Legacy Vertical')"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_products(id,vertical_id,scope,canonical_name,active) VALUES ('trash_legacy_product','trash_legacy_vertical','SHARED','منتج تاريخي محفوظ',true)"); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Migrate(ctx, db, records, sqlMigrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		var name string
		var deleted sql.NullTime
		if err := db.QueryRowContext(ctx, "SELECT canonical_name,deleted_at FROM dsh.catalog_products WHERE id='trash_legacy_product'").Scan(&name, &deleted); err != nil {
			t.Fatal(err)
		}
		if name != "منتج تاريخي محفوظ" || deleted.Valid {
			t.Fatalf("migration unexpectedly changed legacy product: name=%q deleted=%v", name, deleted)
		}
		if _, err := postgres.ReadCatalogProduct(ctx, db, "trash_legacy_product"); err != nil {
			t.Fatalf("pre-existing product missing after migration: %v", err)
		}
	})
}
