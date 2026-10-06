ALTER TABLE dsh.field_acquisition_entitlement_outbox
    ADD COLUMN commercial_store_type_id text;

UPDATE dsh.field_acquisition_entitlement_outbox outbox
SET commercial_store_type_id=store.commercial_store_type_id
FROM dsh.stores store
WHERE store.id=outbox.store_id;

ALTER TABLE dsh.field_acquisition_entitlement_outbox
    DROP CONSTRAINT field_acquisition_entitlement_outbox_state_chk,
    ADD CONSTRAINT field_acquisition_entitlement_outbox_state_chk
        CHECK (state IN ('PENDING', 'WAITING_POLICY', 'WAITING_CLASSIFICATION', 'POSTED', 'FAILED')),
    ADD CONSTRAINT field_acquisition_entitlement_outbox_commercial_type_fk
        FOREIGN KEY (commercial_store_type_id, vertical_id)
        REFERENCES dsh.commercial_store_types(id, vertical_id) ON DELETE RESTRICT;

UPDATE dsh.field_acquisition_entitlement_outbox
SET state='WAITING_CLASSIFICATION',
    last_error='the acquired store has no canonical commercial type',
    updated_at=clock_timestamp()
WHERE commercial_store_type_id IS NULL AND state <> 'POSTED';

CREATE INDEX field_acquisition_outbox_commercial_type_idx
    ON dsh.field_acquisition_entitlement_outbox(commercial_store_type_id,state,next_attempt_at)
    WHERE commercial_store_type_id IS NOT NULL;

CREATE FUNCTION dsh.requeue_classified_field_acquisition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.commercial_store_type_id IS NOT NULL AND
       NEW.commercial_store_type_id IS DISTINCT FROM OLD.commercial_store_type_id THEN
        UPDATE dsh.field_acquisition_entitlement_outbox
        SET commercial_store_type_id=NEW.commercial_store_type_id,
            vertical_id=NEW.primary_vertical_id,
            state='PENDING',
            last_error=NULL,
            next_attempt_at=clock_timestamp(),
            updated_at=clock_timestamp()
        WHERE store_id=NEW.id AND state='WAITING_CLASSIFICATION';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER stores_requeue_field_acquisition_after_classification
    AFTER UPDATE OF commercial_store_type_id ON dsh.stores
    FOR EACH ROW EXECUTE FUNCTION dsh.requeue_classified_field_acquisition();
