-- The canonical Order must reference a Cart belonging to the SAME Client
-- and Store. A single-column cart FK admits cross-Client/cross-Store links
-- when a writer bypasses DSH's request-layer checks.
-- This forward migration preserves the adopted v11/v180 history and all rows.
-- Any existing mismatch aborts the migration rather than rewriting an Order.
ALTER TABLE dsh.commerce_carts
    ADD CONSTRAINT commerce_carts_id_store_client_uq
        UNIQUE (id, store_id, client_actor_id);

ALTER TABLE dsh.commerce_orders
    ADD CONSTRAINT commerce_orders_cart_store_client_fk
        FOREIGN KEY (cart_id, store_id, client_actor_id)
        REFERENCES dsh.commerce_carts(id, store_id, client_actor_id)
        ON DELETE RESTRICT;

-- The composite FK also proves both the Cart and Store exist, because the
-- Cart itself has a Store FK. Retire the two weaker redundant Order checks.
ALTER TABLE dsh.commerce_orders
    DROP CONSTRAINT commerce_orders_cart_fk,
    DROP CONSTRAINT commerce_orders_store_fk;
