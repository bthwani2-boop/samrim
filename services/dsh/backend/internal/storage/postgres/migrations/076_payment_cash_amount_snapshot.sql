ALTER TABLE dsh.commerce_orders
    ADD COLUMN payment_cash_amount_minor bigint;

-- Historical orders collected the full payable in cash. New checkout rows
-- persist the cash remainder returned by WLT's canonical allocation.
UPDATE dsh.commerce_orders
SET payment_cash_amount_minor = total_amount_minor
WHERE payment_cash_amount_minor IS NULL;

ALTER TABLE dsh.commerce_orders
    ALTER COLUMN payment_cash_amount_minor SET NOT NULL,
    ADD CONSTRAINT commerce_orders_payment_cash_amount_chk
        CHECK (payment_cash_amount_minor >= 0 AND payment_cash_amount_minor <= total_amount_minor);
