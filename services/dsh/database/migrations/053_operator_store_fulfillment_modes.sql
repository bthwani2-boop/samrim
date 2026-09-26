ALTER TABLE dsh.store_fulfillment_modes_audit
    DROP CONSTRAINT store_fulfillment_modes_audit_actor_chk,
    ADD CONSTRAINT store_fulfillment_modes_audit_actor_chk CHECK (
        length(btrim(acting_actor_id)) BETWEEN 1 AND 128
    );
