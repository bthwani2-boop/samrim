-- DSH-owned city-scoped operational limits for Store availability.
-- Apply after 001, 002 and 003 only in an isolated DSH schema.
-- No seed/default and no implicit Operator approval. Missing policy => deny writes.
-- Bounds below are technical storage/safety limits, not the effective business setting.
-- An authorized, audited Operator Policies writer must provision and version each city.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_limits (
    city_id text PRIMARY KEY REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    max_pause_seconds integer NOT NULL CHECK (max_pause_seconds BETWEEN 0 AND 31536000),
    max_preparation_minutes integer NOT NULL CHECK (max_preparation_minutes BETWEEN 0 AND 1440),
    version bigint NOT NULL CHECK (version >= 1),
    changed_by_actor text NOT NULL CHECK (char_length(trim(changed_by_actor)) > 0),
    change_reason text NOT NULL CHECK (char_length(trim(change_reason)) BETWEEN 1 AND 300),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Historical operational audits predate this policy version: keep them NULL,
-- never fabricate a version for an action that was recorded before the policy.
ALTER TABLE __SCHEMA__.store_operational_audit
    ADD COLUMN IF NOT EXISTS policy_version bigint CHECK (policy_version >= 1);

-- Policy history belongs to DSH. A new version records the exact values and
-- actor that were effective; old pre-audit policy rows are not backfilled.
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_operational_limits_audit (
    city_id text NOT NULL REFERENCES __SCHEMA__.service_cities(id) ON DELETE RESTRICT,
    version bigint NOT NULL CHECK (version >= 1),
    max_pause_seconds integer NOT NULL CHECK (max_pause_seconds BETWEEN 0 AND 31536000),
    max_preparation_minutes integer NOT NULL CHECK (max_preparation_minutes BETWEEN 0 AND 1440),
    acting_actor_id text NOT NULL,
    reason text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (city_id, version)
);

-- Enforce monotonically versioned policy changes even if a future writer
-- accidentally omits its expected-version check. Never erase the sole policy.
CREATE OR REPLACE FUNCTION __SCHEMA__.guard_store_operational_limits_version()
RETURNS trigger LANGUAGE plpgsql AS $policy$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Store operational limits cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.version <> 1 THEN
        RAISE EXCEPTION 'Initial Store operational limits version must be 1';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.city_id IS DISTINCT FROM OLD.city_id
        OR NEW.version <> OLD.version + 1) THEN
        RAISE EXCEPTION 'Store operational limits version must advance by one';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$policy$;

DROP TRIGGER IF EXISTS trg_store_operational_limits_version ON __SCHEMA__.store_operational_limits;
CREATE TRIGGER trg_store_operational_limits_version
BEFORE INSERT OR UPDATE OR DELETE ON __SCHEMA__.store_operational_limits
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.guard_store_operational_limits_version();

CREATE OR REPLACE FUNCTION __SCHEMA__.audit_store_operational_limits()
RETURNS trigger LANGUAGE plpgsql AS $policy$
BEGIN
    INSERT INTO __SCHEMA__.store_operational_limits_audit
        (city_id,version,max_pause_seconds,max_preparation_minutes,acting_actor_id,reason)
    VALUES (NEW.city_id,NEW.version,NEW.max_pause_seconds,
        NEW.max_preparation_minutes,NEW.changed_by_actor,NEW.change_reason);
    RETURN NULL;
END;
$policy$;

DROP TRIGGER IF EXISTS trg_store_operational_limits_audit ON __SCHEMA__.store_operational_limits;
CREATE TRIGGER trg_store_operational_limits_audit
AFTER INSERT OR UPDATE ON __SCHEMA__.store_operational_limits
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.audit_store_operational_limits();

DROP TRIGGER IF EXISTS trg_store_operational_limits_audit_immutable ON __SCHEMA__.store_operational_limits_audit;
CREATE TRIGGER trg_store_operational_limits_audit_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.store_operational_limits_audit
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();
