CREATE TABLE dsh.catalog_registry_audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    acting_actor_id text NOT NULL,
    correlation_id text NOT NULL,
    reason text NOT NULL,
    expected_version integer NOT NULL,
    resulting_version integer NOT NULL,
    before_state jsonb,
    after_state jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_registry_audit_entity_chk CHECK (entity_type IN ('vertical', 'category', 'attribute_rule')),
    CONSTRAINT catalog_registry_audit_action_chk CHECK (action IN ('CREATED', 'UPDATED')),
    CONSTRAINT catalog_registry_audit_actor_chk CHECK (length(btrim(acting_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT catalog_registry_audit_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128),
    CONSTRAINT catalog_registry_audit_reason_chk CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
    CONSTRAINT catalog_registry_audit_version_chk CHECK (expected_version >= 0 AND resulting_version = expected_version + 1)
);

CREATE INDEX catalog_registry_audit_entity_history_idx
    ON dsh.catalog_registry_audit_events(entity_type, entity_id, recorded_at DESC, id DESC);
