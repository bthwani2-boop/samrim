ALTER TABLE dsh.catalog_products
    ADD COLUMN description text NOT NULL DEFAULT '';

ALTER TABLE dsh.catalog_products
    ADD CONSTRAINT catalog_products_description_chk
    CHECK (char_length(description) <= 4000);
