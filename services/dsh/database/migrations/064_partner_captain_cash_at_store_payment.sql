ALTER TABLE dsh.commerce_orders
    DROP CONSTRAINT commerce_orders_payment_method_chk,
    ADD CONSTRAINT commerce_orders_payment_method_chk CHECK (
        (fulfillment_mode = 'BTHWANI_CAPTAIN' AND payment_method = 'CASH_ON_DELIVERY')
        OR (fulfillment_mode IN ('PARTNER_CAPTAIN', 'CUSTOMER_PICKUP') AND payment_method = 'CASH_AT_STORE')
    );
