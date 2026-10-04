DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM dsh.catalog_variant_identifiers identifier
        JOIN dsh.catalog_product_variants variant ON variant.id=identifier.variant_id
        JOIN dsh.catalog_products product ON product.id=variant.product_id
        WHERE identifier.identifier_type='SKU' AND product.scope<>'STORE_SCOPED'
    ) THEN
        RAISE EXCEPTION 'catalog migration 093 cannot assign legacy SKU identifiers attached to shared Products to a Store';
    END IF;
END $$;

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
  AND p.active=true
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

ALTER TABLE dsh.commerce_verticals
    DROP CONSTRAINT commerce_verticals_catalog_model_chk,
    DROP COLUMN catalog_model;

ALTER TABLE dsh.catalog_variant_identifiers
    ADD COLUMN store_id text;

UPDATE dsh.catalog_variant_identifiers identifier
SET store_id=product.store_id
FROM dsh.catalog_product_variants variant
JOIN dsh.catalog_products product ON product.id=variant.product_id
WHERE identifier.variant_id=variant.id
  AND identifier.identifier_type='SKU'
  AND product.scope='STORE_SCOPED';

ALTER TABLE dsh.catalog_variant_identifiers
    ADD CONSTRAINT catalog_variant_identifiers_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    ADD CONSTRAINT catalog_variant_identifiers_scope_chk CHECK (
        (identifier_type='SKU' AND store_id IS NOT NULL) OR
        (identifier_type<>'SKU' AND store_id IS NULL)
    );

DROP INDEX dsh.catalog_variant_identifiers_value_uq;
DO $$
BEGIN
    IF EXISTS (
        SELECT lower(btrim(identifier_value))
        FROM dsh.catalog_variant_identifiers
        WHERE identifier_type IN ('GTIN','EAN','UPC','LEGACY_BARCODE')
        GROUP BY lower(btrim(identifier_value))
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'catalog migration 093 requires globally unique GTIN/EAN/UPC/barcode values before identifier scope cutover';
    END IF;
END $$;

CREATE UNIQUE INDEX catalog_variant_identifiers_global_value_uq
    ON dsh.catalog_variant_identifiers(lower(btrim(identifier_value)))
    WHERE identifier_type IN ('GTIN','EAN','UPC','LEGACY_BARCODE');
CREATE UNIQUE INDEX catalog_variant_identifiers_store_sku_uq
    ON dsh.catalog_variant_identifiers(store_id, lower(btrim(identifier_value)))
    WHERE identifier_type='SKU';
CREATE INDEX catalog_variant_identifiers_store_idx
    ON dsh.catalog_variant_identifiers(store_id, lower(btrim(identifier_value)))
    WHERE store_id IS NOT NULL;

ALTER TABLE dsh.catalog_product_proposals
    DROP CONSTRAINT catalog_product_proposals_identifier_type_chk,
    ADD CONSTRAINT catalog_product_proposals_identifier_type_chk
        CHECK (proposed_identifier_type IS NULL OR proposed_identifier_type IN ('GTIN','EAN','UPC'));

ALTER TABLE dsh.catalog_store_offer_audit
    ADD COLUMN old_price_minor bigint,
    ADD COLUMN new_price_minor bigint,
    ADD COLUMN provenance text;

WITH price_history AS (
    SELECT id,
           price_minor AS new_price_minor,
           lag(price_minor) OVER (PARTITION BY offer_id ORDER BY created_at,id) AS old_price_minor
    FROM dsh.catalog_store_offer_audit
)
UPDATE dsh.catalog_store_offer_audit audit
SET old_price_minor=history.old_price_minor,
    new_price_minor=history.new_price_minor,
    provenance='LEGACY'
FROM price_history history
WHERE audit.id=history.id;

ALTER TABLE dsh.catalog_store_offer_audit
    ALTER COLUMN new_price_minor SET NOT NULL,
    ALTER COLUMN provenance SET NOT NULL,
    ADD CONSTRAINT catalog_store_offer_audit_price_history_chk CHECK (
        (old_price_minor IS NULL OR old_price_minor>0) AND new_price_minor>0 AND new_price_minor=price_minor
    ),
    ADD CONSTRAINT catalog_store_offer_audit_provenance_chk CHECK (
        provenance IN ('PARTNER','CONTROL_PANEL','FIELD_INITIAL_CATALOG','IMPORT','QUICK_PRICES','LEGACY')
    );

CREATE INDEX catalog_store_offer_audit_quick_prices_idx
    ON dsh.catalog_store_offer_audit(store_id,created_at DESC,offer_id);
