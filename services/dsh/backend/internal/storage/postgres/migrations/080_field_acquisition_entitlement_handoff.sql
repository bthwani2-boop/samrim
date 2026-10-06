ALTER TABLE dsh.field_commission_publication_outbox
    ADD COLUMN joining_case_id text,
    ADD COLUMN partner_actor_id text;

UPDATE dsh.field_commission_publication_outbox o
SET joining_case_id=jc.id,
    partner_actor_id=jc.partner_actor_id
FROM dsh.joining_cases jc
WHERE jc.store_id=o.store_id
  AND jc.origin='field'
  AND jc.originating_field_actor_id=o.field_actor_id;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dsh.field_commission_publication_outbox WHERE joining_case_id IS NULL OR partner_actor_id IS NULL) THEN
        RAISE EXCEPTION 'field acquisition outbox has no canonical joining case and partner attribution';
    END IF;
END $$;

ALTER TABLE dsh.field_commission_publication_outbox
    ALTER COLUMN joining_case_id SET NOT NULL,
    ALTER COLUMN partner_actor_id SET NOT NULL,
    ADD CONSTRAINT field_acquisition_outbox_case_fk FOREIGN KEY (joining_case_id) REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT,
    ADD CONSTRAINT field_acquisition_outbox_partner_chk CHECK (length(btrim(partner_actor_id)) BETWEEN 1 AND 128),
    DROP CONSTRAINT field_commission_publication_outbox_idempotency_uq,
    DROP CONSTRAINT field_commission_publication_outbox_state_chk,
    ADD CONSTRAINT field_acquisition_outbox_state_chk CHECK (state IN ('PENDING', 'WAITING_POLICY', 'POSTED', 'FAILED'));

CREATE INDEX field_acquisition_outbox_case_idx
    ON dsh.field_commission_publication_outbox(joining_case_id, state, next_attempt_at);

ALTER TABLE dsh.field_commission_publication_outbox
    RENAME TO field_acquisition_entitlement_outbox;

ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_commission_publication_outbox_pkey TO field_acquisition_entitlement_outbox_pkey;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_commission_publication_outbox_store_uq TO field_acquisition_entitlement_outbox_store_uq;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_commission_publication_outbox_store_fk TO field_acquisition_entitlement_outbox_store_fk;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_commission_publication_outbox_field_actor_chk TO field_acquisition_entitlement_outbox_field_actor_chk;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_commission_publication_outbox_vertical_chk TO field_acquisition_entitlement_outbox_vertical_chk;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_commission_publication_outbox_hash_chk TO field_acquisition_entitlement_outbox_hash_chk;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_commission_publication_outbox_correlation_chk TO field_acquisition_entitlement_outbox_correlation_chk;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_commission_publication_outbox_attempts_chk TO field_acquisition_entitlement_outbox_attempts_chk;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_acquisition_outbox_case_fk TO field_acquisition_entitlement_outbox_case_fk;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_acquisition_outbox_partner_chk TO field_acquisition_entitlement_outbox_partner_chk;
ALTER TABLE dsh.field_acquisition_entitlement_outbox RENAME CONSTRAINT field_acquisition_outbox_state_chk TO field_acquisition_entitlement_outbox_state_chk;
ALTER INDEX dsh.field_commission_publication_outbox_pending_idx RENAME TO field_acquisition_entitlement_outbox_pending_idx;
ALTER INDEX dsh.field_acquisition_outbox_case_idx RENAME TO field_acquisition_entitlement_outbox_case_idx;
