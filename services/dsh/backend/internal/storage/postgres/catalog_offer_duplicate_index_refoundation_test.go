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

func TestRetireDuplicateStoreOfferIndexFreshAndUpgrade(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL is required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	assertIndex := func(t *testing.T, ctx context.Context, db *sql.DB) {
		t.Helper()
		var canonical, duplicate bool
		if err := db.QueryRowContext(ctx, "SELECT to_regclass('dsh.catalog_store_offers_store_idx') IS NOT NULL, to_regclass('dsh.catalog_store_offers_store_created_registry_idx') IS NOT NULL").
			Scan(&canonical, &duplicate); err != nil {
			t.Fatal(err)
		}
		if !canonical || duplicate {
			t.Fatalf("Store Offer index cutover incomplete: canonical=%t duplicate=%t", canonical, duplicate)
		}
	}
	t.Run("fresh-v182", func(t *testing.T) {
		withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
			if len(records) != 182 {
				t.Fatalf("expected v182, got %d", len(records))
			}
			if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
				t.Fatal(err)
			}
			if err := postgres.VerifySchema(ctx, db, records); err != nil {
				t.Fatal(err)
			}
			assertIndex(t, ctx, db)
		}, 4*time.Minute)
	})
	t.Run("retained-v181-upgrade", func(t *testing.T) {
		withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
			if len(records) != 182 {
				t.Fatalf("expected v182, got %d", len(records))
			}
			// Build the preceding canonical schema in a disposable database,
			// recording its actual versioned hashes; never patch live history.
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			for _, ddl := range []string{
				"CREATE SCHEMA dsh",
				"CREATE TABLE dsh.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
			} {
				if _, err := tx.ExecContext(ctx, ddl); err != nil {
					t.Fatal(err)
				}
			}
			for i := 0; i < 181; i++ {
				if _, err := tx.ExecContext(ctx, sqls[i]); err != nil {
					t.Fatalf("replay previous migration v%d: %v", i+1, err)
				}
				if _, err := tx.ExecContext(ctx,
					"INSERT INTO dsh.schema_migrations(version,name,sha256) VALUES($1,$2,$3)",
					records[i].Version, records[i].Name, records[i].SHA256); err != nil {
					t.Fatalf("record previous migration v%d: %v", i+1, err)
				}
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			var original, redundant bool
			if err := db.QueryRowContext(ctx, "SELECT to_regclass('dsh.catalog_store_offers_store_idx') IS NOT NULL, to_regclass('dsh.catalog_store_offers_store_created_registry_idx') IS NOT NULL").
				Scan(&original, &redundant); err != nil || !original || !redundant {
				t.Fatalf("v181 fixture must have both indices: original=%t redundant=%t err=%v", original, redundant, err)
			}
			if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
				t.Fatal(err)
			}
			if err := postgres.VerifySchema(ctx, db, records); err != nil {
				t.Fatal(err)
			}
			assertIndex(t, ctx, db)
		}, 4*time.Minute)
	})
}
