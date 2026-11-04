package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

// This test owns a newly-created disposable database and never touches local
// accounts, financial data, or the retained BThwani development database.
func TestCustomerCatalogIndexMigrationPreflight(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	name := fmt.Sprintf("dsh_index_guard_%d", time.Now().UnixNano())
	if _, err := root.ExecContext(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, closeCleanup := context.WithTimeout(context.Background(), 20*time.Second)
		defer closeCleanup()
		if _, err := root.ExecContext(cleanupCtx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
			t.Errorf("remove disposable database: %v", err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Path = "/" + name
	db, err := sql.Open("postgres", parsed.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.ExecContext(ctx, `
CREATE SCHEMA dsh;
CREATE EXTENSION pg_trgm;
CREATE TABLE dsh.catalog_products (id integer PRIMARY KEY, canonical_name text NOT NULL);
`); err != nil {
		t.Fatal(err)
	}

	testPreflight := func(wantBuild bool, wantError string) {
		t.Helper()
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		apply, err := prepareCustomerCatalogNameIndex(ctx, tx)
		if wantError != "" {
			if err == nil || !strings.Contains(err.Error(), wantError) {
				t.Fatalf("preflight got apply=%v err=%v, want %s", apply, err, wantError)
			}
			_ = tx.Rollback()
			return
		}
		if err != nil || apply != wantBuild {
			t.Fatalf("preflight got apply=%v err=%v, want apply=%v", apply, err, wantBuild)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}

	// Fresh empty schema may build the canonical index transactionally.
	testPreflight(true, "")
	const statement = "CREATE INDEX catalog_products_customer_name_trgm_idx ON dsh.catalog_products USING gin (lower(canonical_name) gin_trgm_ops)"
	if _, err := db.ExecContext(ctx, statement); err != nil {
		t.Fatal(err)
	}
	// An exactly matching and valid pre-existing index must be reused.
	testPreflight(false, "")
	// Index identity must not depend on search_path / operator-class rendering.
	qualifiedTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := qualifiedTx.ExecContext(ctx, "SET LOCAL search_path = pg_catalog"); err != nil {
		_ = qualifiedTx.Rollback()
		t.Fatal(err)
	}
	if build, err := prepareCustomerCatalogNameIndex(ctx, qualifiedTx); err != nil || build {
		_ = qualifiedTx.Rollback()
		t.Fatalf("schema-independent index reuse got build=%v err=%v", build, err)
	}
	if err := qualifiedTx.Commit(); err != nil {
		t.Fatal(err)
	}

	if _, err := db.ExecContext(ctx, "DROP INDEX dsh.catalog_products_customer_name_trgm_idx"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.catalog_products VALUES (1, 'test')"); err != nil {
		t.Fatal(err)
	}
	// A populated catalog must never take the old blocking v170 path.
	testPreflight(false, "CREATE INDEX CONCURRENTLY")
	if _, err := db.ExecContext(ctx, "CREATE INDEX CONCURRENTLY catalog_products_customer_name_trgm_idx ON dsh.catalog_products USING gin (lower(canonical_name) gin_trgm_ops)"); err != nil {
		t.Fatal(err)
	}
	testPreflight(false, "")

	// A same-named but incompatible index must not bypass validation.
	if _, err := db.ExecContext(ctx, "DROP INDEX dsh.catalog_products_customer_name_trgm_idx"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "CREATE INDEX catalog_products_customer_name_trgm_idx ON dsh.catalog_products (id)"); err != nil {
		t.Fatal(err)
	}
	testPreflight(false, "different definition")
	if _, err := db.ExecContext(ctx, "DROP INDEX dsh.catalog_products_customer_name_trgm_idx"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, statement+" WHERE canonical_name <> ''"); err != nil {
		t.Fatal(err)
	}
	testPreflight(false, "different definition")
}
