-- Add an explicit per-offer quantity inventory mode without changing the
-- existing availability-only offers. Quantity-on-hand offers reserve stock at
-- checkout, release it on cancellation/rejection, and consume it on delivery.

ALTER TABLE dsh.catalog_store_offers
    ADD COLUMN inventory_on_hand_base_units bigint NOT NULL DEFAULT 0,
    ADD COLUMN inventory_reserved_base_units bigint NOT NULL DEFAULT 0;

ALTER TABLE dsh.catalog_store_offers
    DROP CONSTRAINT catalog_store_offers_inventory_policy_chk,
    ADD CONSTRAINT catalog_store_offers_inventory_policy_chk
        CHECK (inventory_policy IN ('AVAILABILITY_ONLY', 'QUANTITY_ON_HAND')),
    ADD CONSTRAINT catalog_store_offers_inventory_on_hand_chk
        CHECK (inventory_on_hand_base_units >= 0),
    ADD CONSTRAINT catalog_store_offers_inventory_reserved_chk
        CHECK (inventory_reserved_base_units >= 0 AND inventory_reserved_base_units <= inventory_on_hand_base_units),
    ADD CONSTRAINT catalog_store_offers_inventory_mode_chk
        CHECK (inventory_policy = 'QUANTITY_ON_HAND' OR (inventory_on_hand_base_units = 0 AND inventory_reserved_base_units = 0));

CREATE INDEX catalog_store_offers_inventory_idx
    ON dsh.catalog_store_offers(inventory_policy, inventory_on_hand_base_units, inventory_reserved_base_units);

ALTER TABLE dsh.commerce_order_lines
    ADD COLUMN inventory_reserved_base_units bigint NOT NULL DEFAULT 0,
    ADD CONSTRAINT commerce_order_lines_inventory_reserved_chk
        CHECK (inventory_reserved_base_units >= 0);
