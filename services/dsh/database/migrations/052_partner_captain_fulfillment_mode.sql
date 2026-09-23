ALTER TABLE dsh.stores
    DROP CONSTRAINT stores_fulfillment_modes_chk,
    ADD CONSTRAINT stores_fulfillment_modes_chk CHECK (
        cardinality(fulfillment_modes) > 0
        AND fulfillment_modes <@ ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[]
    );

ALTER TABLE dsh.joining_cases
    DROP CONSTRAINT joining_cases_first_store_fulfillment_modes_chk,
    ADD CONSTRAINT joining_cases_first_store_fulfillment_modes_chk CHECK (
        cardinality(first_store_fulfillment_modes) > 0
        AND first_store_fulfillment_modes <@ ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[]
    );

ALTER TABLE dsh.store_fulfillment_modes_idempotency
    DROP CONSTRAINT store_fulfillment_modes_idempotency_modes_chk,
    ADD CONSTRAINT store_fulfillment_modes_idempotency_modes_chk CHECK (result_fulfillment_modes IN (
        ARRAY['BTHWANI_CAPTAIN']::text[],
        ARRAY['PARTNER_CAPTAIN']::text[],
        ARRAY['CUSTOMER_PICKUP']::text[],
        ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN']::text[],
        ARRAY['BTHWANI_CAPTAIN','CUSTOMER_PICKUP']::text[],
        ARRAY['PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[],
        ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[]
    ));

ALTER TABLE dsh.store_fulfillment_modes_audit
    DROP CONSTRAINT store_fulfillment_modes_audit_from_modes_chk,
    ADD CONSTRAINT store_fulfillment_modes_audit_from_modes_chk CHECK (from_modes IN (
        ARRAY['BTHWANI_CAPTAIN']::text[],
        ARRAY['PARTNER_CAPTAIN']::text[],
        ARRAY['CUSTOMER_PICKUP']::text[],
        ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN']::text[],
        ARRAY['BTHWANI_CAPTAIN','CUSTOMER_PICKUP']::text[],
        ARRAY['PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[],
        ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[]
    )),
    DROP CONSTRAINT store_fulfillment_modes_audit_to_modes_chk,
    ADD CONSTRAINT store_fulfillment_modes_audit_to_modes_chk CHECK (to_modes IN (
        ARRAY['BTHWANI_CAPTAIN']::text[],
        ARRAY['PARTNER_CAPTAIN']::text[],
        ARRAY['CUSTOMER_PICKUP']::text[],
        ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN']::text[],
        ARRAY['BTHWANI_CAPTAIN','CUSTOMER_PICKUP']::text[],
        ARRAY['PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[],
        ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[]
    ));
