ALTER TABLE dsh.stores
    ADD COLUMN fulfillment_modes text[] NOT NULL DEFAULT ARRAY['BTHWANI_CAPTAIN']::text[],
    ADD CONSTRAINT stores_fulfillment_modes_chk CHECK (
        cardinality(fulfillment_modes) > 0
        AND fulfillment_modes <@ ARRAY['BTHWANI_CAPTAIN','CUSTOMER_PICKUP']::text[]
    );

ALTER TABLE dsh.joining_cases
    ADD COLUMN first_store_fulfillment_modes text[] NOT NULL DEFAULT ARRAY['BTHWANI_CAPTAIN']::text[],
    ADD CONSTRAINT joining_cases_first_store_fulfillment_modes_chk CHECK (
        cardinality(first_store_fulfillment_modes) > 0
        AND first_store_fulfillment_modes <@ ARRAY['BTHWANI_CAPTAIN','CUSTOMER_PICKUP']::text[]
    );

ALTER TABLE dsh.commerce_orders
    ALTER COLUMN address_id DROP NOT NULL,
    ALTER COLUMN address_version DROP NOT NULL,
    ALTER COLUMN address_text DROP NOT NULL,
    ALTER COLUMN address_latitude DROP NOT NULL,
    ALTER COLUMN address_longitude DROP NOT NULL,
    ALTER COLUMN serviceability_policy_version DROP NOT NULL,
    ALTER COLUMN serviceability_status DROP NOT NULL,
    ALTER COLUMN serviceability_address_version DROP NOT NULL,
    DROP CONSTRAINT commerce_orders_address_version_chk,
    DROP CONSTRAINT commerce_orders_coordinates_chk,
    DROP CONSTRAINT commerce_orders_serviceability_status_chk,
    DROP CONSTRAINT commerce_orders_state_chk,
    ADD CONSTRAINT commerce_orders_state_chk CHECK (state IN ('CREATED','PARTNER_ACCEPTED','PREPARING','READY_FOR_DISPATCH','READY_FOR_PICKUP','PICKED_UP','CAPTAIN_ASSIGNED','IN_CUSTODY','DELIVERED','DELIVERY_FAILED','REJECTED','CANCELLED')),
    ADD CONSTRAINT commerce_orders_fulfillment_evidence_chk CHECK (
        (fulfillment_mode='CUSTOMER_PICKUP'
            AND address_id IS NULL AND address_version IS NULL AND address_text IS NULL
            AND address_latitude IS NULL AND address_longitude IS NULL
            AND serviceability_policy_version IS NULL AND serviceability_status IS NULL
            AND serviceability_address_version IS NULL)
        OR
        (fulfillment_mode<>'CUSTOMER_PICKUP'
            AND address_id IS NOT NULL AND address_version>0 AND address_text IS NOT NULL
            AND address_latitude BETWEEN -90 AND 90 AND address_longitude BETWEEN -180 AND 180
            AND serviceability_policy_version IS NOT NULL AND serviceability_status='SERVICEABLE'
            AND serviceability_address_version>0)
    );

ALTER TABLE dsh.commerce_order_transition_idempotency
    DROP CONSTRAINT commerce_order_transition_state_chk,
    ADD CONSTRAINT commerce_order_transition_state_chk CHECK (requested_state IN ('PARTNER_ACCEPTED','PREPARING','READY_FOR_DISPATCH','READY_FOR_PICKUP','PICKED_UP','REJECTED','CANCELLED'));

ALTER TABLE dsh.commerce_order_delivery_proofs
    ADD COLUMN proof_type text NOT NULL DEFAULT 'DELIVERY',
    ADD CONSTRAINT commerce_order_delivery_proof_type_chk CHECK (proof_type IN ('DELIVERY','STORE_PICKUP'));

CREATE INDEX commerce_order_pickup_queue_idx
    ON dsh.commerce_orders(store_id,created_at ASC,id ASC)
    WHERE fulfillment_mode='CUSTOMER_PICKUP' AND state IN ('CREATED','PARTNER_ACCEPTED','PREPARING','READY_FOR_PICKUP');
