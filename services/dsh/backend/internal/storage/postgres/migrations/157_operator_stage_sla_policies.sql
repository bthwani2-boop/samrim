-- Stage SLA authority: explicitly approved, append-only targets scoped to delivery mode.
-- No default targets: an unapproved deadline must never be reported as contractual.
CREATE TABLE dsh.operator_stage_sla_policies (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fulfillment_mode text NOT NULL CHECK (fulfillment_mode IN ('BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP')),
    stage text NOT NULL CHECK (stage IN ('CREATED','PARTNER_ACCEPTED','PREPARING','READY_FOR_DISPATCH','READY_FOR_PICKUP','CAPTAIN_ASSIGNED','IN_CUSTODY')),
    target_minutes integer NOT NULL CHECK (target_minutes BETWEEN 1 AND 1440),
    warning_minutes integer NOT NULL CHECK (warning_minutes BETWEEN 0 AND 1439 AND warning_minutes < target_minutes),
    policy_version integer NOT NULL CHECK (policy_version >= 1),
    effective_at timestamptz NOT NULL,
    approved_by_actor_id text NOT NULL CHECK (length(trim(approved_by_actor_id)) BETWEEN 1 AND 128),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT operator_stage_sla_policies_version_uq UNIQUE (fulfillment_mode,stage,policy_version),
    CONSTRAINT operator_stage_sla_policies_effective_uq UNIQUE (fulfillment_mode,stage,effective_at)
);
CREATE INDEX operator_stage_sla_policies_lookup_idx ON dsh.operator_stage_sla_policies (fulfillment_mode,stage,effective_at DESC);
-- Stable history; no silent edits to targets after a stage begins.
CREATE FUNCTION dsh.reject_stage_sla_policy_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'SLA policies are immutable; insert a new version with a later effective_at';
END;
$$;
CREATE TRIGGER operator_stage_sla_immutable
BEFORE UPDATE OR DELETE ON dsh.operator_stage_sla_policies
FOR EACH ROW EXECUTE FUNCTION dsh.reject_stage_sla_policy_mutation();
