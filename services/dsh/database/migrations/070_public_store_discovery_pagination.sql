CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX stores_published_city_created_registry_idx
    ON dsh.stores(service_city_id, created_at DESC, id DESC)
    WHERE publication_state='published' AND publication_changed_at IS NOT NULL;

CREATE INDEX stores_published_city_name_search_idx
    ON dsh.stores USING gin (lower(name) gin_trgm_ops)
    WHERE publication_state='published' AND publication_changed_at IS NOT NULL;
