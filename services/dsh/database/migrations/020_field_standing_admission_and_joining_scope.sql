-- Field standing admission is a DSH-owned eligibility fact. Identity remains
-- the sole actor/role owner and is called only after this fact is eligible.
CREATE TABLE dsh.field_admissions (
    id text PRIMARY KEY,
    actor_id text UNIQUE,
    contact_phone_e164 text,
    state text NOT NULL DEFAULT 'pending_identity',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_admissions_state_chk CHECK (state IN ('pending_identity', 'eligible', 'suspended')),
    CONSTRAINT field_admissions_version_chk CHECK (version > 0),
    CONSTRAINT field_admissions_phone_chk CHECK (contact_phone_e164 IS NULL OR contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT field_admissions_identity_state_chk CHECK ((state = 'pending_identity' AND actor_id IS NULL AND contact_phone_e164 IS NOT NULL) OR (state <> 'pending_identity' AND actor_id IS NOT NULL AND contact_phone_e164 IS NULL))
);
CREATE UNIQUE INDEX field_admissions_pending_phone_uq
    ON dsh.field_admissions(contact_phone_e164)
    WHERE state = 'pending_identity';
CREATE INDEX field_admissions_state_idx
    ON dsh.field_admissions(state, updated_at, actor_id);

CREATE TABLE dsh.field_admission_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    admission_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    result_state text NOT NULL,
    result_actor_id text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_admission_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, admission_id, operation),
    CONSTRAINT field_admission_idempotency_operation_chk CHECK (operation = 'create'),
    CONSTRAINT field_admission_idempotency_state_chk CHECK (result_state IN ('pending_identity', 'eligible', 'suspended')),
    CONSTRAINT field_admission_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT field_admission_idempotency_admission_fk FOREIGN KEY (admission_id) REFERENCES dsh.field_admissions(id) ON DELETE RESTRICT
);
CREATE INDEX field_admission_idempotency_admission_idx
    ON dsh.field_admission_idempotency(admission_id, created_at DESC);

CREATE TABLE dsh.field_admission_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    admission_id text NOT NULL,
    actor_id text,
    from_state text,
    to_state text NOT NULL,
    from_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_admission_audit_event_type_chk CHECK (event_type IN ('field_admission_created', 'field_admission_bound', 'field_admission_suspended', 'field_admission_restored')),
    CONSTRAINT field_admission_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT field_admission_audit_admission_fk FOREIGN KEY (admission_id) REFERENCES dsh.field_admissions(id) ON DELETE RESTRICT,
    CONSTRAINT field_admission_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX field_admission_audit_admission_idx
    ON dsh.field_admission_audit(admission_id, created_at DESC);

ALTER TABLE dsh.joining_cases
    ADD COLUMN originating_field_actor_id text,
    ADD CONSTRAINT joining_cases_field_actor_chk CHECK (originating_field_actor_id IS NULL OR length(btrim(originating_field_actor_id)) > 0);

CREATE INDEX joining_cases_field_actor_idx
    ON dsh.joining_cases(originating_field_actor_id, created_at DESC, id DESC)
    WHERE originating_field_actor_id IS NOT NULL;
