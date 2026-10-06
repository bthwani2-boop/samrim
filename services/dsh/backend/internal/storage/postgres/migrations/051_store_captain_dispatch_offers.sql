ALTER TABLE dsh.captain_dispatch_offers
    ADD COLUMN source_store_id text;

ALTER TABLE dsh.captain_dispatch_offers
    ADD CONSTRAINT captain_dispatch_offers_source_store_fk
        FOREIGN KEY (source_store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    ADD CONSTRAINT captain_dispatch_offers_source_store_id_chk
        CHECK (source_store_id IS NULL OR length(btrim(source_store_id)) BETWEEN 1 AND 128);

ALTER TABLE dsh.captain_operation_idempotency
    DROP CONSTRAINT captain_operation_idempotency_operation_chk,
    ADD CONSTRAINT captain_operation_idempotency_operation_chk
        CHECK (operation IN ('availability', 'dispatch', 'store_dispatch', 'respond_offer', 'reassign', 'store_confirm', 'pickup', 'complete', 'recover'));
