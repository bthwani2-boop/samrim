-- Customer discovery shortcuts are presentation records; commercial Store types
-- and shared Product categories keep their separate internal authority.
CREATE TABLE dsh.catalog_shopping_shortcuts (
    id text PRIMARY KEY,
    vertical_id text NOT NULL REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT,
    title_ar text NOT NULL,
    ordinal integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_shopping_shortcuts_id_chk CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,127}$'),
    CONSTRAINT catalog_shopping_shortcuts_title_chk CHECK (char_length(btrim(title_ar)) BETWEEN 2 AND 160),
    CONSTRAINT catalog_shopping_shortcuts_ordinal_chk CHECK (ordinal BETWEEN 0 AND 9999),
    CONSTRAINT catalog_shopping_shortcuts_version_chk CHECK (version > 0),
    CONSTRAINT catalog_shopping_shortcuts_id_vertical_uq UNIQUE (id, vertical_id)
);
CREATE UNIQUE INDEX catalog_shopping_shortcuts_vertical_title_uq
    ON dsh.catalog_shopping_shortcuts (vertical_id,lower(btrim(title_ar)));
CREATE INDEX catalog_shopping_shortcuts_order_idx
    ON dsh.catalog_shopping_shortcuts (vertical_id,active,ordinal,id);

CREATE TABLE dsh.catalog_shopping_shortcut_targets (
    shortcut_id text NOT NULL,
    vertical_id text NOT NULL,
    store_type_id text,
    category_id text,
    CONSTRAINT catalog_shopping_shortcut_target_one_chk
        CHECK ((store_type_id IS NOT NULL) <> (category_id IS NOT NULL)),
    CONSTRAINT catalog_shopping_shortcut_target_shortcut_fk
        FOREIGN KEY (shortcut_id,vertical_id) REFERENCES dsh.catalog_shopping_shortcuts(id,vertical_id) ON DELETE CASCADE,
    CONSTRAINT catalog_shopping_shortcut_target_type_fk
        FOREIGN KEY (store_type_id,vertical_id) REFERENCES dsh.commercial_store_types(id,vertical_id) ON DELETE RESTRICT,
    CONSTRAINT catalog_shopping_shortcut_target_category_fk
        FOREIGN KEY (vertical_id,category_id) REFERENCES dsh.catalog_categories(vertical_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX catalog_shopping_shortcut_type_uq
    ON dsh.catalog_shopping_shortcut_targets (shortcut_id,store_type_id) WHERE store_type_id IS NOT NULL;
CREATE UNIQUE INDEX catalog_shopping_shortcut_category_uq
    ON dsh.catalog_shopping_shortcut_targets (shortcut_id,category_id) WHERE category_id IS NOT NULL;
CREATE INDEX catalog_shopping_shortcut_target_type_idx
    ON dsh.catalog_shopping_shortcut_targets (store_type_id,shortcut_id) WHERE store_type_id IS NOT NULL;
CREATE INDEX catalog_shopping_shortcut_target_category_idx
    ON dsh.catalog_shopping_shortcut_targets (category_id,shortcut_id) WHERE category_id IS NOT NULL;

ALTER TABLE dsh.catalog_registry_mutation_idempotency
    DROP CONSTRAINT catalog_registry_mutation_entity_chk,
    ADD CONSTRAINT catalog_registry_mutation_entity_chk
        CHECK (entity_type IN ('vertical','category','attribute_rule','commercial_store_type','store_type_assignment','shopping_shortcut'));
ALTER TABLE dsh.catalog_registry_audit_events
    DROP CONSTRAINT catalog_registry_audit_entity_chk,
    ADD CONSTRAINT catalog_registry_audit_entity_chk
        CHECK (entity_type IN ('vertical','category','attribute_rule','commercial_store_type','store_type_assignment','attribute_definition','attribute_enum_option','shopping_shortcut'));

-- One canonical eligibility join for shortcut discovery and store pagination.
-- Visibility/publication itself still belongs to catalog_customer_visible_offers.
CREATE FUNCTION dsh.shopping_shortcut_matches_product(
    p_shortcut_id text, p_store_id text, p_product_id text
) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1
        FROM dsh.catalog_shopping_shortcuts shortcut
        JOIN dsh.stores store ON store.id=p_store_id
          AND store.primary_vertical_id=shortcut.vertical_id
        JOIN dsh.catalog_products product ON product.id=p_product_id
          AND product.vertical_id=shortcut.vertical_id
        JOIN dsh.commerce_verticals vertical
          ON vertical.id=shortcut.vertical_id AND vertical.active=true
        WHERE shortcut.id=p_shortcut_id AND shortcut.active=true
          AND EXISTS (
              SELECT 1 FROM dsh.catalog_shopping_shortcut_targets target
              WHERE target.shortcut_id=shortcut.id
                AND (
                    (target.store_type_id=store.commercial_store_type_id
                      AND EXISTS (SELECT 1 FROM dsh.commercial_store_types st
                                  WHERE st.id=target.store_type_id AND st.active=true))
                    OR (target.category_id IS NOT NULL
                      AND EXISTS (
                          WITH RECURSIVE eligible_categories(id) AS (
                              SELECT category.id FROM dsh.catalog_categories category
                              WHERE category.id=target.category_id
                                AND category.vertical_id=shortcut.vertical_id
                                AND category.active=true
                              UNION
                              SELECT child.id FROM dsh.catalog_categories child
                              JOIN eligible_categories parent ON child.parent_category_id=parent.id
                              WHERE child.vertical_id=shortcut.vertical_id AND child.active=true
                          )
                          SELECT 1 FROM dsh.catalog_product_categories pc
                          JOIN eligible_categories cat ON cat.id=pc.category_id
                          WHERE pc.product_id=product.id
                      ))
                )
          )
    )
$$;
