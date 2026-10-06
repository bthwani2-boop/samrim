ALTER TABLE dsh.commerce_verticals
    ADD COLUMN catalog_model text;

ALTER TABLE dsh.commerce_verticals
    ADD CONSTRAINT commerce_verticals_catalog_model_chk
    CHECK (catalog_model IS NULL OR catalog_model IN ('SHARED_CATALOG', 'STORE_LOCAL_CATALOG'));
