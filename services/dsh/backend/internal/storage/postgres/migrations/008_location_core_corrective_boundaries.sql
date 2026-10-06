-- Forward-only Location Core corrective cutover.
-- Store publication/version remains the J1 authority. Delivery-origin writes
-- use their own version and timestamp while retaining the canonical columns.

ALTER TABLE dsh.stores
    ADD COLUMN delivery_origin_version integer NOT NULL DEFAULT 0,
    ADD COLUMN delivery_origin_updated_at timestamptz;

UPDATE dsh.stores
SET delivery_origin_version = 1,
    delivery_origin_updated_at = updated_at
WHERE delivery_origin_latitude IS NOT NULL
  AND delivery_origin_longitude IS NOT NULL;

ALTER TABLE dsh.stores
    ADD CONSTRAINT stores_delivery_origin_version_chk
        CHECK (delivery_origin_version >= 0),
    ADD CONSTRAINT stores_delivery_origin_updated_at_chk
        CHECK ((delivery_origin_version = 0 AND delivery_origin_updated_at IS NULL)
            OR (delivery_origin_version > 0 AND delivery_origin_updated_at IS NOT NULL));

ALTER TABLE dsh.delivery_address_mutation_idempotency
    DROP CONSTRAINT delivery_address_idempotency_result_version_chk,
    DROP COLUMN result_version;

ALTER TABLE dsh.store_origin_mutation_idempotency
    DROP CONSTRAINT store_origin_idempotency_expected_version_chk,
    ADD CONSTRAINT store_origin_idempotency_expected_version_chk CHECK (expected_version >= 0);

ALTER TABLE dsh.delivery_address_audit
    DROP CONSTRAINT delivery_address_audit_text_chk,
    DROP CONSTRAINT delivery_address_audit_latitude_chk,
    DROP CONSTRAINT delivery_address_audit_longitude_chk,
    DROP COLUMN address_text,
    DROP COLUMN latitude,
    DROP COLUMN longitude;

ALTER TABLE dsh.store_origin_mutation_idempotency
    DROP CONSTRAINT store_origin_idempotency_result_version_chk,
    DROP CONSTRAINT store_origin_idempotency_latitude_chk,
    DROP CONSTRAINT store_origin_idempotency_longitude_chk,
    DROP COLUMN result_version,
    DROP COLUMN result_latitude,
    DROP COLUMN result_longitude,
    DROP COLUMN result_updated_at;

ALTER TABLE dsh.store_origin_audit
    DROP CONSTRAINT store_origin_audit_expected_version_chk,
    DROP CONSTRAINT store_origin_audit_latitude_chk,
    DROP CONSTRAINT store_origin_audit_longitude_chk,
    ADD CONSTRAINT store_origin_audit_expected_version_chk CHECK (expected_version >= 0),
    DROP COLUMN latitude,
    DROP COLUMN longitude;
