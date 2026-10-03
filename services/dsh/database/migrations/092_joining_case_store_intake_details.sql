ALTER TABLE dsh.joining_cases
    ADD COLUMN owner_full_name text,
    ADD COLUMN first_store_address text,
    ADD COLUMN first_store_working_hours jsonb,
    ADD COLUMN first_store_proof_type text,
    ADD COLUMN first_store_notes text;

ALTER TABLE dsh.joining_cases
    ADD CONSTRAINT joining_cases_owner_full_name_chk CHECK (owner_full_name IS NULL OR char_length(owner_full_name) BETWEEN 2 AND 160),
    ADD CONSTRAINT joining_cases_first_store_address_chk CHECK (first_store_address IS NULL OR char_length(first_store_address) BETWEEN 4 AND 500),
    ADD CONSTRAINT joining_cases_first_store_working_hours_chk CHECK (first_store_working_hours IS NULL OR (jsonb_typeof(first_store_working_hours) = 'object' AND jsonb_typeof(first_store_working_hours->'intervals') = 'array')),
    ADD CONSTRAINT joining_cases_first_store_proof_type_chk CHECK (first_store_proof_type IS NULL OR first_store_proof_type IN ('COMMERCIAL_REGISTRATION', 'IDENTITY_DOCUMENT', 'FREELANCE_WORK_DOCUMENT')),
    ADD CONSTRAINT joining_cases_first_store_notes_chk CHECK (first_store_notes IS NULL OR char_length(first_store_notes) <= 1000);

ALTER TABLE dsh.stores
    ADD COLUMN address_text text,
    ADD COLUMN business_working_hours jsonb;

ALTER TABLE dsh.stores
    ADD CONSTRAINT stores_address_text_chk CHECK (address_text IS NULL OR char_length(address_text) BETWEEN 4 AND 500),
    ADD CONSTRAINT stores_business_working_hours_chk CHECK (business_working_hours IS NULL OR (jsonb_typeof(business_working_hours) = 'object' AND jsonb_typeof(business_working_hours->'intervals') = 'array'));

CREATE TABLE dsh.joining_case_private_evidence (
    joining_case_id text PRIMARY KEY,
    proof_number_key_id text NOT NULL,
    proof_number_ciphertext bytea NOT NULL,
    proof_image_key_id text,
    proof_image_ciphertext bytea,
    proof_image_content_type text,
    proof_image_ciphertext_sha256 text,
    proof_image_byte_size bigint,
    proof_image_uploaded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT joining_case_private_evidence_case_fk FOREIGN KEY (joining_case_id) REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT,
    CONSTRAINT joining_case_private_evidence_key_id_chk CHECK (proof_number_key_id ~ '^[a-zA-Z0-9_-]{1,32}$'),
    CONSTRAINT joining_case_private_evidence_image_key_id_chk CHECK (proof_image_key_id IS NULL OR proof_image_key_id ~ '^[a-zA-Z0-9_-]{1,32}$'),
    CONSTRAINT joining_case_private_evidence_image_content_type_chk CHECK (proof_image_content_type IS NULL OR proof_image_content_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT joining_case_private_evidence_image_ciphertext_sha_chk CHECK (proof_image_ciphertext_sha256 IS NULL OR proof_image_ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT joining_case_private_evidence_image_size_chk CHECK (proof_image_byte_size IS NULL OR proof_image_byte_size BETWEEN 1 AND 10485760),
    CONSTRAINT joining_case_private_evidence_image_pair_chk CHECK (
        (proof_image_key_id IS NULL AND proof_image_ciphertext IS NULL AND proof_image_content_type IS NULL AND proof_image_ciphertext_sha256 IS NULL AND proof_image_byte_size IS NULL AND proof_image_uploaded_at IS NULL)
        OR
        (proof_image_key_id IS NOT NULL AND proof_image_ciphertext IS NOT NULL AND proof_image_content_type IS NOT NULL AND proof_image_ciphertext_sha256 IS NOT NULL AND proof_image_byte_size IS NOT NULL AND proof_image_uploaded_at IS NOT NULL)
    )
);

CREATE TABLE dsh.joining_case_private_evidence_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    joining_case_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    authority_source text NOT NULL,
    expected_version integer,
    result_version integer,
    request_hash text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT joining_case_private_evidence_audit_case_fk FOREIGN KEY (joining_case_id) REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT,
    CONSTRAINT joining_case_private_evidence_audit_event_chk CHECK (event_type IN ('proof_image_uploaded', 'proof_details_read', 'proof_image_downloaded')),
    CONSTRAINT joining_case_private_evidence_audit_authority_chk CHECK (authority_source IN ('field', 'partner', 'operator')),
    CONSTRAINT joining_case_private_evidence_audit_expected_version_chk CHECK (expected_version IS NULL OR expected_version > 0),
    CONSTRAINT joining_case_private_evidence_audit_result_version_chk CHECK (result_version IS NULL OR result_version > 0),
    CONSTRAINT joining_case_private_evidence_audit_idempotency_chk CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 128),
    CONSTRAINT joining_case_private_evidence_audit_request_hash_chk CHECK (request_hash IS NULL OR char_length(request_hash) BETWEEN 1 AND 128),
    CONSTRAINT joining_case_private_evidence_audit_correlation_chk CHECK (char_length(correlation_id) BETWEEN 8 AND 128),
    CONSTRAINT joining_case_private_evidence_audit_actor_chk CHECK (char_length(acting_actor_id) BETWEEN 1 AND 128)
);
CREATE UNIQUE INDEX joining_case_private_evidence_upload_idempotency_uq
    ON dsh.joining_case_private_evidence_audit(idempotency_key) WHERE event_type = 'proof_image_uploaded';
CREATE INDEX joining_case_private_evidence_audit_case_idx
    ON dsh.joining_case_private_evidence_audit(joining_case_id, created_at DESC);
