-- Explicit marketing contact consent (not transactional notifications).
-- No row means DENIED; actor IDs only, never phone/email or wallet PII.
CREATE TABLE dsh.customer_marketing_consents (
    client_actor_id text NOT NULL CHECK (btrim(client_actor_id) <> '' AND length(client_actor_id)<=128),
    channel text NOT NULL CHECK (channel IN ('PUSH','SMS','EMAIL','IN_APP')),
    purpose text NOT NULL CHECK (purpose='PROMOTIONS'),
    status text NOT NULL CHECK (status IN ('OPTED_IN','OPTED_OUT')),
    version integer NOT NULL CHECK (version>0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (client_actor_id,channel,purpose)
);
CREATE TABLE dsh.customer_marketing_consent_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_actor_id text NOT NULL,
    channel text NOT NULL,
    purpose text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('OPTED_IN','OPTED_OUT')),
    expected_version integer NOT NULL CHECK (expected_version>=0),
    result_version integer NOT NULL CHECK (result_version>0),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    source text NOT NULL CHECK (source IN ('CUSTOMER_APP','CUSTOMER_WEB')),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT consent_event_actor_key_unique UNIQUE(client_actor_id,idempotency_key),
    CONSTRAINT consent_event_identity_fk FOREIGN KEY(client_actor_id,channel,purpose)
      REFERENCES dsh.customer_marketing_consents(client_actor_id,channel,purpose) ON DELETE RESTRICT
);
CREATE INDEX customer_marketing_consent_events_audit_idx
  ON dsh.customer_marketing_consent_events(client_actor_id,recorded_at DESC,id DESC);
