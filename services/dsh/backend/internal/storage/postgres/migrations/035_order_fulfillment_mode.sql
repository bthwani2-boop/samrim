ALTER TABLE dsh.commerce_orders
    ADD COLUMN fulfillment_mode text;

UPDATE dsh.commerce_orders
SET fulfillment_mode='BTHWANI_CAPTAIN'
WHERE fulfillment_mode IS NULL;

ALTER TABLE dsh.commerce_orders
    ALTER COLUMN fulfillment_mode SET NOT NULL,
    ALTER COLUMN fulfillment_mode SET DEFAULT 'BTHWANI_CAPTAIN',
    ADD CONSTRAINT commerce_orders_fulfillment_mode_chk CHECK (
        fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP')
    );

CREATE INDEX commerce_orders_fulfillment_mode_state_idx
    ON dsh.commerce_orders(fulfillment_mode,state,created_at ASC,id ASC);
