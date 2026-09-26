-- Store the minimum reviewed person profile before creating an Identity role.
-- Legacy pre-Identity rows have no recorded review evidence, so they return to
-- profile review and require an operator to complete the Arabic name.
ALTER TABLE dsh.field_admissions
    ADD COLUMN full_name_ar text,
    DROP CONSTRAINT field_admissions_state_chk,
    DROP CONSTRAINT field_admissions_identity_state_chk;

UPDATE dsh.field_admissions SET state='pending_review' WHERE state='pending_identity';
UPDATE dsh.field_admission_idempotency SET result_state='pending_review' WHERE operation='create' AND result_state='pending_identity';

ALTER TABLE dsh.field_admissions
    ADD CONSTRAINT field_admissions_state_chk CHECK (state IN ('pending_review', 'pending_identity', 'eligible', 'suspended')),
    ADD CONSTRAINT field_admissions_name_chk CHECK (full_name_ar IS NULL OR (char_length(btrim(full_name_ar)) BETWEEN 2 AND 120)),
    ADD CONSTRAINT field_admissions_identity_state_chk CHECK (((state IN ('pending_review', 'pending_identity')) AND actor_id IS NULL AND contact_phone_e164 IS NOT NULL) OR (state IN ('eligible', 'suspended') AND actor_id IS NOT NULL AND contact_phone_e164 IS NULL));

DROP INDEX dsh.field_admissions_pending_phone_uq;
CREATE UNIQUE INDEX field_admissions_pending_phone_uq
    ON dsh.field_admissions(contact_phone_e164)
    WHERE state IN ('pending_review', 'pending_identity');

ALTER TABLE dsh.field_admission_idempotency
    DROP CONSTRAINT field_admission_idempotency_operation_chk,
    DROP CONSTRAINT field_admission_idempotency_state_chk;
ALTER TABLE dsh.field_admission_idempotency
    ADD CONSTRAINT field_admission_idempotency_operation_chk CHECK (operation IN ('create', 'approve', 'bind', 'profile')),
    ADD CONSTRAINT field_admission_idempotency_state_chk CHECK (result_state IN ('pending_review', 'pending_identity', 'eligible', 'suspended'));
ALTER TABLE dsh.field_admission_audit
    DROP CONSTRAINT field_admission_audit_event_type_chk;
ALTER TABLE dsh.field_admission_audit
    ADD CONSTRAINT field_admission_audit_event_type_chk CHECK (event_type IN ('field_admission_created', 'field_admission_profile_updated', 'field_admission_approved', 'field_admission_bound', 'field_admission_suspended', 'field_admission_restored'));

ALTER TABLE dsh.captain_admissions
    ADD COLUMN full_name_ar text,
    DROP CONSTRAINT captain_admissions_state_chk,
    DROP CONSTRAINT captain_admissions_identity_state_chk,
    DROP CONSTRAINT captain_admissions_pending_availability_chk;

UPDATE dsh.captain_admissions SET state='pending_review' WHERE state='pending_identity';
UPDATE dsh.captain_admission_idempotency SET result_state='pending_review' WHERE operation='create' AND result_state='pending_identity';

ALTER TABLE dsh.captain_admissions
    ADD CONSTRAINT captain_admissions_state_chk CHECK (state IN ('pending_review', 'pending_identity', 'eligible', 'suspended')),
    ADD CONSTRAINT captain_admissions_name_chk CHECK (full_name_ar IS NULL OR (char_length(btrim(full_name_ar)) BETWEEN 2 AND 120)),
    ADD CONSTRAINT captain_admissions_identity_state_chk CHECK (((state IN ('pending_review', 'pending_identity')) AND actor_id IS NULL AND contact_phone_e164 IS NOT NULL) OR (state IN ('eligible', 'suspended') AND actor_id IS NOT NULL AND contact_phone_e164 IS NULL)),
    ADD CONSTRAINT captain_admissions_pending_availability_chk CHECK (state NOT IN ('pending_review', 'pending_identity') OR availability_state = 'unavailable');

DROP INDEX dsh.captain_admissions_pending_phone_uq;
CREATE UNIQUE INDEX captain_admissions_pending_phone_uq
    ON dsh.captain_admissions(contact_phone_e164)
    WHERE state IN ('pending_review', 'pending_identity');

ALTER TABLE dsh.captain_admission_idempotency
    DROP CONSTRAINT captain_admission_idempotency_operation_chk,
    DROP CONSTRAINT captain_admission_idempotency_state_chk;
ALTER TABLE dsh.captain_admission_idempotency
    ADD CONSTRAINT captain_admission_idempotency_operation_chk CHECK (operation IN ('create', 'approve', 'bind', 'profile')),
    ADD CONSTRAINT captain_admission_idempotency_state_chk CHECK (result_state IN ('pending_review', 'pending_identity', 'eligible', 'suspended'));
ALTER TABLE dsh.captain_admission_audit
    DROP CONSTRAINT captain_admission_audit_event_type_chk;
ALTER TABLE dsh.captain_admission_audit
    ADD CONSTRAINT captain_admission_audit_event_type_chk CHECK (event_type IN ('captain_admission_created', 'captain_admission_profile_updated', 'captain_admission_approved', 'captain_admission_bound', 'captain_admission_suspended', 'captain_admission_restored', 'captain_availability_changed'));
