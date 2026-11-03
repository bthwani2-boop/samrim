package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// prepareCustomerCatalogNameIndex keeps the canonical v170 checksum unchanged.
// An existing populated catalog must receive its verified GIN expression index
// through CREATE INDEX CONCURRENTLY *outside* the transactional DSH migrator.
// This function never runs a blocking full index build on a populated table.
func prepareCustomerCatalogNameIndex(ctx context.Context, tx *sql.Tx) (bool, error) {
	const indexName = "dsh.catalog_products_customer_name_trgm_idx"
	var valid, ready bool
	var definition string
	err := tx.QueryRowContext(ctx, `
SELECT i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
FROM pg_catalog.pg_index i
WHERE i.indexrelid=to_regclass('dsh.catalog_products_customer_name_trgm_idx')
  AND i.indrelid='dsh.catalog_products'::regclass
`).Scan(&valid, &ready, &definition)
	switch {
	case err == nil:
		if !valid || !ready || !strings.HasSuffix(strings.TrimSpace(definition), "ON dsh.catalog_products USING gin (lower(canonical_name) gin_trgm_ops)") {
			return false, fmt.Errorf("%s exists but is invalid or has a different definition; review and repair it independently", indexName)
		}
		// The index is correct already. Record v170 with its original checksum.
		return false, nil
	case !errors.Is(err, sql.ErrNoRows):
		return false, fmt.Errorf("inspect catalog search index: %w", err)
	}

	var colliding bool
	if err := tx.QueryRowContext(ctx,
		"SELECT to_regclass('dsh.catalog_products_customer_name_trgm_idx') IS NOT NULL").Scan(&colliding); err != nil {
		return false, fmt.Errorf("check catalog index name: %w", err)
	}
	if colliding {
		return false, fmt.Errorf("%s name belongs to a different relation", indexName)
	}

	var populated bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.catalog_products)").Scan(&populated); err != nil {
		return false, fmt.Errorf("inspect catalog content: %w", err)
	}
	if populated {
		return false, errors.New("catalog has existing products: prebuild and verify the correct GIN index with CREATE INDEX CONCURRENTLY outside the DSH migration transaction; refusing a write-blocking v170 migration")
	}

	// Fail immediately if a writer is active; never wait behind application
	// writes merely to create an index during fresh, empty bootstrap.
	if _, err := tx.ExecContext(ctx, "LOCK TABLE dsh.catalog_products IN SHARE MODE NOWAIT"); err != nil {
		return false, fmt.Errorf("catalog is busy; refusing a write-blocking index build: %w", err)
	}
	// Recheck under the lock: the table may have become populated meanwhile.
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.catalog_products)").Scan(&populated); err != nil {
		return false, fmt.Errorf("recheck catalog content: %w", err)
	}
	if populated {
		return false, errors.New("catalog became populated before index lock; concurrent index prebuild is required")
	}
	return true, nil
}
