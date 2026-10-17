-- Prevent ambiguous Arabic labels in the canonical commerce registry.
-- Preserve existing IDs, Store references, product assignments and WLT agreements.
-- A conflict in existing rows must stop migration rather than silently merge data.
CREATE UNIQUE INDEX commerce_verticals_name_ar_uq
    ON dsh.commerce_verticals (lower(btrim(name_ar)));

CREATE UNIQUE INDEX commercial_store_types_vertical_name_ar_uq
    ON dsh.commercial_store_types (vertical_id, lower(btrim(name_ar)));

-- A category is unique only among its siblings, never across unrelated branches.
-- Trashed categories are excluded so an archived name does not block reuse.
CREATE UNIQUE INDEX catalog_categories_sibling_name_ar_uq
    ON dsh.catalog_categories (vertical_id, coalesce(parent_category_id, ''), lower(btrim(name_ar)))
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX catalog_categories_sibling_name_en_uq
    ON dsh.catalog_categories (vertical_id, coalesce(parent_category_id, ''), lower(btrim(name_en)))
    WHERE deleted_at IS NULL;
