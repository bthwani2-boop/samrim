-- Cross-Store customer search accepts in-name terms of three or more
-- Unicode characters. pg_trgm was enabled by migration 070.
-- This expression matches lower(p.canonical_name) in the DSH public query.
CREATE INDEX catalog_products_customer_name_trgm_idx
    ON dsh.catalog_products USING gin (lower(canonical_name) gin_trgm_ops);
