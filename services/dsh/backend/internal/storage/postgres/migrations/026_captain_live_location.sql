CREATE TABLE dsh.captain_location_snapshots (
    assignment_id text PRIMARY KEY,
    order_id text NOT NULL,
    captain_actor_id text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    version integer NOT NULL DEFAULT 1,
    last_idempotency_key text NOT NULL,
    last_request_hash text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_location_snapshots_latitude_chk CHECK (latitude >= -90 AND latitude <= 90),
    CONSTRAINT captain_location_snapshots_longitude_chk CHECK (longitude >= -180 AND longitude <= 180),
    CONSTRAINT captain_location_snapshots_version_chk CHECK (version > 0),
    CONSTRAINT captain_location_snapshots_assignment_fk FOREIGN KEY (assignment_id) REFERENCES dsh.captain_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT captain_location_snapshots_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);
CREATE INDEX captain_location_snapshots_order_idx
    ON dsh.captain_location_snapshots(order_id, updated_at DESC);

CREATE TABLE dsh.captain_location_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    assignment_id text NOT NULL,
    order_id text NOT NULL,
    captain_actor_id text NOT NULL,
    result_version integer NOT NULL,
    result_latitude double precision NOT NULL,
    result_longitude double precision NOT NULL,
    result_updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_location_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, assignment_id),
    CONSTRAINT captain_location_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT captain_location_idempotency_latitude_chk CHECK (result_latitude >= -90 AND result_latitude <= 90),
    CONSTRAINT captain_location_idempotency_longitude_chk CHECK (result_longitude >= -180 AND result_longitude <= 180),
    CONSTRAINT captain_location_idempotency_assignment_fk FOREIGN KEY (assignment_id) REFERENCES dsh.captain_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT captain_location_idempotency_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);
CREATE INDEX captain_location_idempotency_assignment_idx
    ON dsh.captain_location_mutation_idempotency(assignment_id, created_at DESC);

CREATE TABLE dsh.captain_location_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    order_id text NOT NULL,
    assignment_id text NOT NULL,
    captain_actor_id text NOT NULL,
    result_version integer NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_location_audit_event_type_chk CHECK (event_type = 'captain_location_updated'),
    CONSTRAINT captain_location_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT captain_location_audit_version_chk CHECK (result_version > 0),
    CONSTRAINT captain_location_audit_latitude_chk CHECK (latitude >= -90 AND latitude <= 90),
    CONSTRAINT captain_location_audit_longitude_chk CHECK (longitude >= -180 AND longitude <= 180),
    CONSTRAINT captain_location_audit_assignment_fk FOREIGN KEY (assignment_id) REFERENCES dsh.captain_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT captain_location_audit_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);
CREATE INDEX captain_location_audit_assignment_idx
    ON dsh.captain_location_audit(assignment_id, created_at DESC);
