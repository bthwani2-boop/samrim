-- DSH-owned Captain operational standing. Apply only to an approved isolated
-- dsh_test_* schema after migrations 001-005. Identity owns the high-level role;
-- DSH APPROVED standing alone never creates an Identity credential.
CREATE TABLE __SCHEMA__.captain_standing (
    actor_id text PRIMARY KEY CHECK (char_length(actor_id) BETWEEN 1 AND 128),
    status text NOT NULL CHECK (status IN ('PENDING','APPROVED','SUSPENDED','REVOKED')),
    version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
    changed_by_actor text NOT NULL CHECK (char_length(trim(changed_by_actor)) BETWEEN 1 AND 128),
    change_reason text NOT NULL CHECK (char_length(trim(change_reason)) BETWEEN 1 AND 300),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE __SCHEMA__.captain_standing_commands (
    actor_id text NOT NULL REFERENCES __SCHEMA__.captain_standing(actor_id) ON DELETE RESTRICT,
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    resulting_version bigint NOT NULL CHECK (resulting_version >= 2),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id, operation_id)
);
CREATE TABLE __SCHEMA__.captain_standing_audit (
    actor_id text NOT NULL REFERENCES __SCHEMA__.captain_standing(actor_id) ON DELETE RESTRICT,
    version bigint NOT NULL CHECK (version >= 2),
    operation_id text NOT NULL,
    previous_status text NOT NULL CHECK (previous_status IN ('PENDING','APPROVED','SUSPENDED','REVOKED')),
    new_status text NOT NULL CHECK (new_status IN ('APPROVED','SUSPENDED','REVOKED')),
    acting_actor_id text NOT NULL CHECK (char_length(trim(acting_actor_id)) BETWEEN 1 AND 128),
    change_reason text NOT NULL CHECK (char_length(trim(change_reason)) BETWEEN 1 AND 300),
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_id, version),
    UNIQUE (actor_id, operation_id),
    FOREIGN KEY (actor_id, operation_id)
        REFERENCES __SCHEMA__.captain_standing_commands(actor_id, operation_id) ON DELETE RESTRICT
);
-- Preserve every review and replay decision; the prior DSH schema already
-- defines reject_operational_audit_rewrite() in migration 002.
CREATE TRIGGER trg_captain_standing_audit_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.captain_standing_audit
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();
CREATE TRIGGER trg_captain_standing_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.captain_standing_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();
CREATE TRIGGER trg_captain_standing_no_delete
BEFORE DELETE ON __SCHEMA__.captain_standing
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();
