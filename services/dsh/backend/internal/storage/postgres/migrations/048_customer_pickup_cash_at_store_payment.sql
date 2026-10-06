ALTER TABLE dsh.commerce_orders
    DROP CONSTRAINT commerce_orders_payment_method_chk,
    ADD CONSTRAINT commerce_orders_payment_method_chk CHECK (
        (fulfillment_mode = 'CUSTOMER_PICKUP' AND payment_method = 'CASH_AT_STORE')
        OR (fulfillment_mode <> 'CUSTOMER_PICKUP' AND payment_method = 'CASH_ON_DELIVERY')
    );
