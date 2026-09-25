CREATE INDEX commerce_promotions_starts_registry_idx
    ON dsh.commerce_promotions(starts_at DESC, id DESC);
CREATE INDEX commerce_promotions_state_starts_registry_idx
    ON dsh.commerce_promotions(state, starts_at DESC, id DESC);
CREATE INDEX commerce_promotions_code_prefix_registry_idx
    ON dsh.commerce_promotions(lower(code) text_pattern_ops);
CREATE INDEX commerce_promotions_name_prefix_registry_idx
    ON dsh.commerce_promotions(lower(name_ar) text_pattern_ops);
CREATE INDEX commerce_promotions_id_prefix_registry_idx
    ON dsh.commerce_promotions(lower(id) text_pattern_ops);

CREATE INDEX discovery_content_priority_registry_idx
    ON dsh.discovery_content(ordinal ASC, starts_at DESC, id DESC);
CREATE INDEX discovery_content_state_kind_priority_registry_idx
    ON dsh.discovery_content(state, kind, ordinal ASC, starts_at DESC, id DESC);
CREATE INDEX discovery_content_created_registry_idx
    ON dsh.discovery_content(created_at DESC, id DESC);
CREATE INDEX discovery_content_state_kind_created_registry_idx
    ON dsh.discovery_content(state, kind, created_at DESC, id DESC);
CREATE INDEX discovery_content_title_prefix_registry_idx
    ON dsh.discovery_content(lower(title_ar) text_pattern_ops);
CREATE INDEX discovery_content_id_prefix_registry_idx
    ON dsh.discovery_content(lower(id) text_pattern_ops);

CREATE INDEX stores_published_city_name_registry_idx
    ON dsh.stores(service_city_id, lower(name), id)
    WHERE publication_state='published';
CREATE INDEX stores_published_city_name_prefix_registry_idx
    ON dsh.stores(service_city_id, lower(name) text_pattern_ops)
    WHERE publication_state='published';
