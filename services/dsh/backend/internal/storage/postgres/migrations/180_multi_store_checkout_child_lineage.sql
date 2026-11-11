-- One DSH Order belongs to its exact Store and Cart; a multi-Store child
-- must never attach another Store's or another Cart's canonical Order.
-- These composite keys are required for declarative foreign-key integrity;
-- the single-column primary keys alone cannot express the relationship.
-- Existing invalid links fail this upgrade instead of being silently changed.
ALTER TABLE dsh.commerce_carts
    ADD CONSTRAINT commerce_carts_id_store_uq UNIQUE (id, store_id);
ALTER TABLE dsh.commerce_orders
    ADD CONSTRAINT commerce_orders_id_cart_store_uq UNIQUE (id, cart_id, store_id);

ALTER TABLE dsh.commerce_multi_store_checkout_children
    ADD CONSTRAINT commerce_multi_store_child_cart_store_fk
        FOREIGN KEY (cart_id, store_id)
        REFERENCES dsh.commerce_carts(id, store_id) ON DELETE RESTRICT,
    ADD CONSTRAINT commerce_multi_store_child_order_cart_store_fk
        FOREIGN KEY (order_id, cart_id, store_id)
        REFERENCES dsh.commerce_orders(id, cart_id, store_id) ON DELETE RESTRICT;

-- The composite FKs cover the old one-column references without retaining
-- three separate constraint checks for every child mutation.
ALTER TABLE dsh.commerce_multi_store_checkout_children
    DROP CONSTRAINT commerce_multi_store_checkout_children_cart_fk,
    DROP CONSTRAINT commerce_multi_store_checkout_children_store_fk,
    DROP CONSTRAINT commerce_multi_store_checkout_children_order_fk;

-- A canonical Order may be the successful result of only one checkout child
-- globally, not once per arbitrarily named parent. Keep this one stronger
-- uniqueness guarantee and retire its weaker per-parent equivalent.
CREATE UNIQUE INDEX commerce_multi_store_checkout_child_order_uq
    ON dsh.commerce_multi_store_checkout_children(order_id)
    WHERE order_id IS NOT NULL;
DROP INDEX dsh.commerce_multi_store_checkout_children_order_uq;
