package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// prepareCustomerCatalogNameIndex keeps the canonical v170 checksum unchanged.
// An existing populated catalog must receive its verified GIN expression index
// through CREATE INDEX CONCURRENTLY *outside* the transactional DSH migrator.
// This function never runs a blocking full index build on a populated table.
func prepareCustomerCatalogNameIndex(ctx context.Context, tx *sql.Tx) (bool, error) {
	const indexName = "dsh.catalog_products_customer_name_trgm_idx"
	// Keep the index definition stable until this migration commits.
	// SHARE UPDATE EXCLUSIVE allows product writes but excludes concurrent index DDL.
	if _, err := tx.ExecContext(ctx, "LOCK TABLE dsh.catalog_products IN SHARE UPDATE EXCLUSIVE MODE NOWAIT"); err != nil {
		return false, fmt.Errorf("catalog is busy; refusing to inspect the catalog index: %w", err)
	}
	var valid, ready, matchesDefinition bool
	err := tx.QueryRowContext(ctx, `
SELECT i.indisvalid, i.indisready,
       am.amname = 'gin'
       AND i.indnkeyatts = 1
       AND i.indnatts = 1
       AND NOT i.indisunique
       AND NOT i.indisexclusion
       AND i.indpred IS NULL
       AND i.indkey[0] = 0
       AND opc.opcname = 'gin_trgm_ops'
       AND opc.opcnamespace = (SELECT extnamespace FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm')
       AND pg_catalog.pg_get_expr(i.indexprs, i.indrelid, true) = 'lower(canonical_name)'
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
JOIN pg_catalog.pg_am am ON am.oid = idx.relam
JOIN pg_catalog.pg_opclass opc ON opc.oid = i.indclass[0]
WHERE i.indexrelid = to_regclass('dsh.catalog_products_customer_name_trgm_idx')
  AND i.indrelid = 'dsh.catalog_products'::regclass
`).Scan(&valid, &ready, &matchesDefinition)
	switch {
	case err == nil:
		if !valid || !ready || !matchesDefinition {
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
