DO $$ BEGIN
IF EXISTS (SELECT 1 FROM wlt.payment_allocations WHERE platform_subsidy_minor<>0 OR external_official_wallet_amount_minor<>0) THEN
  RAISE EXCEPTION 'legacy subsidy/external-wallet values require explicit reconciliation';
END IF;
END $$;

ALTER TABLE wlt.payment_allocation_events RENAME TO customer_payment_allocation_events;
ALTER TABLE wlt.payment_allocations RENAME TO customer_payment_allocations;
ALTER TABLE wlt.customer_payment_allocations
  DROP CONSTRAINT payment_allocations_nonnegative_chk,
  DROP CONSTRAINT payment_allocations_total_chk,
  DROP CONSTRAINT payment_allocations_conservation_chk,
  DROP CONSTRAINT payment_allocations_cod_split_chk,
  RENAME COLUMN internal_wallet_amount_minor TO internal_balance_amount_minor;
ALTER TABLE wlt.customer_payment_allocations RENAME COLUMN total_minor TO customer_payable_minor;
ALTER TABLE wlt.customer_payment_allocations
  DROP COLUMN platform_subsidy_minor,
  DROP COLUMN external_official_wallet_amount_minor,
  DROP COLUMN cod_product_amount_minor,
  DROP COLUMN cod_delivery_amount_minor;
ALTER TABLE wlt.customer_payment_allocations
  ADD CONSTRAINT customer_payment_allocations_nonnegative_chk CHECK (subtotal_minor>=0 AND delivery_fee_minor>=0 AND discount_minor>=0 AND internal_balance_amount_minor>=0 AND cash_amount_minor>=0 AND customer_payable_minor>0),
  ADD CONSTRAINT customer_payment_allocations_payable_chk CHECK (customer_payable_minor=subtotal_minor+delivery_fee_minor-discount_minor),
  ADD CONSTRAINT customer_payment_allocations_funding_chk CHECK (internal_balance_amount_minor+cash_amount_minor=customer_payable_minor);
ALTER TABLE wlt.customer_payment_allocation_events DROP CONSTRAINT payment_allocation_events_type_chk;
UPDATE wlt.customer_payment_allocation_events SET event_type='CUSTOMER_PAYMENT_ALLOCATION_CREATED' WHERE event_type='PAYMENT_ALLOCATION_CREATED';
ALTER TABLE wlt.customer_payment_allocation_events ADD CONSTRAINT customer_payment_allocation_events_type_chk CHECK (event_type='CUSTOMER_PAYMENT_ALLOCATION_CREATED');
