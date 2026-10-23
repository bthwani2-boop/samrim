-- A single current position per active Captain assignment. No route trail or client access.
CREATE TABLE dsh.captain_mission_latest (
    assignment_id text PRIMARY KEY REFERENCES dsh.captain_assignments(id) ON DELETE CASCADE,
    captain_actor_id text NOT NULL,
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    accuracy_meters double precision NOT NULL CHECK (accuracy_meters BETWEEN 0 AND 5000),
    recorded_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    sequence bigint NOT NULL CHECK (sequence > 0)
);
CREATE INDEX captain_mission_latest_received_idx ON dsh.captain_mission_latest(received_at);
