-- Partial Field drafts must be saveable before fulfillment choices are made.
-- The application validates at least one supported mode before admission.
ALTER TABLE dsh.joining_cases
    DROP CONSTRAINT joining_cases_first_store_fulfillment_modes_chk,
    ADD CONSTRAINT joining_cases_first_store_fulfillment_modes_chk CHECK (
        (state = 'draft' OR cardinality(first_store_fulfillment_modes) > 0)
        AND first_store_fulfillment_modes <@ ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[]
    );
