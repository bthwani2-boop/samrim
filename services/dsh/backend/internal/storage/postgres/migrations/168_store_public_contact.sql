-- Customer-facing business contact is explicitly opted in by the Store owner.
-- Never seed this record from the private joining-case owner phone.
CREATE TABLE dsh.store_public_contacts (
    store_id text PRIMARY KEY REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    phone_e164 text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    whatsapp_phone_e164 text NOT NULL DEFAULT '',
    whatsapp_enabled boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1,
    updated_by_actor_id text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_public_contact_phone_chk CHECK (phone_e164 = '' OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT store_public_contact_whatsapp_chk CHECK (whatsapp_phone_e164 = '' OR whatsapp_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT store_public_contact_enabled_chk CHECK (NOT whatsapp_enabled OR whatsapp_phone_e164 <> ''),
    CONSTRAINT store_public_contact_email_chk CHECK (char_length(email) <= 254 AND email !~ '[[:space:][:cntrl:]]'),
    CONSTRAINT store_public_contact_version_chk CHECK (version > 0)
);

CREATE TABLE dsh.store_public_contact_idempotency (
    idempotency_key text PRIMARY KEY,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    request_hash text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_public_contact_idempotency_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE dsh.store_public_contact_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    actor_id text NOT NULL,
    idempotency_key text NOT NULL UNIQUE REFERENCES dsh.store_public_contact_idempotency(idempotency_key) ON DELETE RESTRICT,
    correlation_id text NOT NULL,
    result_version integer NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_public_contact_audit_version_chk CHECK (result_version > 0)
);

CREATE INDEX store_public_contact_audit_store_idx
    ON dsh.store_public_contact_audit(store_id, changed_at DESC);
