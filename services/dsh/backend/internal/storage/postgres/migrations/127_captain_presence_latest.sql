-- Keep only the latest captain position, never a route or a history of movements.
CREATE TABLE dsh.captain_presence_latest (
    captain_actor_id text PRIMARY KEY,
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX captain_presence_latest_fresh_idx ON dsh.captain_presence_latest(updated_at DESC);
