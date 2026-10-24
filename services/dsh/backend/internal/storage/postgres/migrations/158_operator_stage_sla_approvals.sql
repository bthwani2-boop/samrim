-- Immutable policy approvals need a bounded replay record, not mutable policy rows.
CREATE TABLE dsh.operator_stage_sla_policy_events (
    idempotency_key text PRIMARY KEY CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    policy_id bigint NOT NULL REFERENCES dsh.operator_stage_sla_policies(id),
    request_hash text NOT NULL CHECK (length(request_hash)=64),
    actor_id text NOT NULL CHECK (length(trim(actor_id)) BETWEEN 1 AND 128),
    correlation_id text NOT NULL CHECK (length(correlation_id) BETWEEN 8 AND 128),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX operator_stage_sla_policy_events_policy_idx ON dsh.operator_stage_sla_policy_events(policy_id);
