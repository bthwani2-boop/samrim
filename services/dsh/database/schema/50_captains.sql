-- Fresh, disposable DSH schema. Owner: Captain standing, audit, applications.
-- __SCHEMA__ requires a validated isolated test schema; never overlay retained data.
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

CREATE TABLE __SCHEMA__.captain_interest (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 4 AND 100),
  phone text NOT NULL UNIQUE CHECK (phone ~ '^7[0-9]{8}$'),
  city text NOT NULL CHECK (char_length(trim(city)) BETWEEN 2 AND 80),
  district text NOT NULL CHECK (char_length(trim(district)) BETWEEN 2 AND 100),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('MOTORCYCLE','ELECTRIC','BICYCLE','NONE')),
  plate_registered boolean,
  phone_type text NOT NULL CHECK (phone_type IN ('SMART','BASIC','NONE')),
  experienced boolean NOT NULL,
  experience_details text NOT NULL DEFAULT '' CHECK (char_length(experience_details) <= 200),
  contacted_at timestamptz,
  contacted_by_actor text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((vehicle_type IN ('MOTORCYCLE','ELECTRIC')) = (plate_registered IS NOT NULL)),
  CHECK (experienced OR experience_details = ''),
  CHECK ((contacted_at IS NULL) = (contacted_by_actor IS NULL))
);
CREATE INDEX idx_captain_interest_city_id ON __SCHEMA__.captain_interest(city,id DESC);
CREATE INDEX idx_captain_interest_vehicle_id ON __SCHEMA__.captain_interest(vehicle_type,id DESC);
CREATE INDEX idx_captain_interest_contacted_id ON __SCHEMA__.captain_interest((contacted_at IS NOT NULL),id DESC);
