-- Preserve Product identity, offers, media, orders, and audit history on operator deletion.
ALTER TABLE dsh.catalog_products
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by text,
    ADD COLUMN deletion_reason text,
    ADD CONSTRAINT catalog_product_deletion_facts_chk CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
        OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND char_length(btrim(deletion_reason)) BETWEEN 5 AND 500)
    );
CREATE INDEX catalog_products_trash_idx ON dsh.catalog_products(deleted_at DESC,id DESC) WHERE deleted_at IS NOT NULL;

CREATE TABLE dsh.catalog_product_trash_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idempotency_key text NOT NULL UNIQUE,
    product_id text NOT NULL REFERENCES dsh.catalog_products(id) ON DELETE RESTRICT,
    actor_id text NOT NULL,
    action text NOT NULL CHECK (action IN ('trash','restore')),
    reason text NOT NULL,
    expected_version integer NOT NULL CHECK (expected_version > 0),
    result_version integer NOT NULL CONSTRAINT catalog_trash_result_version_chk CHECK (result_version=expected_version+1),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX catalog_product_trash_audit_product_idx ON dsh.catalog_product_trash_audit(product_id,created_at DESC);

-- Keep customer visibility governed by its existing authoritative view.
CREATE OR REPLACE VIEW dsh.catalog_publishable_offers AS
SELECT o.id AS offer_id
FROM dsh.catalog_store_offers o
JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
JOIN dsh.catalog_products p ON p.id=v.product_id
JOIN dsh.stores s ON s.id=o.store_id
JOIN dsh.commerce_verticals cv ON cv.id=s.primary_vertical_id
WHERE o.publication_state='published'
  AND o.availability=true
  AND o.price_minor>0
  AND p.active=true AND p.deleted_at IS NULL
  AND v.active=true
  AND s.service_city_id IS NOT NULL
  AND s.primary_vertical_id IS NOT NULL
  AND p.vertical_id=s.primary_vertical_id
  AND cv.active=true
  AND ((p.scope='SHARED' AND p.store_id IS NULL) OR (p.scope='STORE_SCOPED' AND p.store_id=o.store_id))
  AND o.quantity_policy=v.measurement_kind
  AND o.quantity_policy<>'VARIABLE_MEASURE'
  AND o.quantity_min_base_units IS NOT NULL
  AND o.quantity_max_base_units IS NOT NULL
  AND o.quantity_step_base_units IS NOT NULL
  AND o.quantity_min_base_units>0 AND o.quantity_max_base_units>=o.quantity_min_base_units AND o.quantity_step_base_units>0
  AND (o.quantity_max_base_units-o.quantity_min_base_units)%o.quantity_step_base_units=0
  AND ((o.pricing_basis='PER_UNIT' AND o.pricing_unit_base_units=1) OR (o.pricing_basis='PER_MEASURE' AND o.pricing_unit_base_units>0))
  AND (o.inventory_policy='AVAILABILITY_ONLY' OR (o.inventory_on_hand_base_units-o.inventory_reserved_base_units>=o.quantity_min_base_units))
  AND ((p.scope='SHARED' AND EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=p.vertical_id WHERE pc.product_id=p.id)) OR (p.scope='STORE_SCOPED' AND NOT EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc WHERE pc.product_id=p.id)))
  AND NOT EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc JOIN dsh.catalog_categories c ON c.id=pc.category_id JOIN dsh.catalog_category_attribute_rules r ON r.category_id=c.id JOIN dsh.catalog_attribute_definitions ad ON ad.id=r.attribute_id WHERE pc.product_id=p.id AND c.active=true AND ad.active=true AND ad.vertical_id=p.vertical_id AND r.required AND ((r.variant_axis AND NOT EXISTS (SELECT 1 FROM dsh.catalog_variant_attribute_values av WHERE av.variant_id=v.id AND av.attribute_id=r.attribute_id)) OR (NOT r.variant_axis AND NOT EXISTS (SELECT 1 FROM dsh.catalog_product_attribute_values av WHERE av.product_id=p.id AND av.attribute_id=r.attribute_id))))
  AND NOT EXISTS (SELECT 1 FROM dsh.catalog_store_offer_modifier_groups og JOIN dsh.catalog_modifier_groups mg ON mg.id=og.group_id WHERE og.offer_id=o.id AND (mg.store_id<>o.store_id OR NOT mg.active OR mg.min_selections > (SELECT COUNT(*) FROM dsh.catalog_modifier_options mo WHERE mo.group_id=mg.id AND mo.availability=true)));
