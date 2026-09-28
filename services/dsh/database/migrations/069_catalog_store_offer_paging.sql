CREATE INDEX catalog_store_offers_store_created_registry_idx
    ON dsh.catalog_store_offers (store_id, created_at, id);
