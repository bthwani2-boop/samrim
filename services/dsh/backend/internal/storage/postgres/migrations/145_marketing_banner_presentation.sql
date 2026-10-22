CREATE TABLE dsh.marketing_banner_presentation (
    placement text PRIMARY KEY CHECK (placement = 'HOME'),
    mode text NOT NULL CHECK (mode IN ('STATIC','CINEMATIC','CROSSFADE')),
    interval_seconds integer NOT NULL CHECK (interval_seconds BETWEEN 3 AND 10),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by_actor_id text NOT NULL DEFAULT 'system',
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO dsh.marketing_banner_presentation (placement,mode,interval_seconds) VALUES ('HOME','CINEMATIC',5);

CREATE TABLE dsh.marketing_banner_presentation_events (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL CHECK (length(request_hash)=64),
    placement text NOT NULL REFERENCES dsh.marketing_banner_presentation(placement),
    expected_version integer NOT NULL CHECK (expected_version>0),
    result_version integer NOT NULL CHECK (result_version>0),
    previous_mode text NOT NULL,
    previous_interval_seconds integer NOT NULL,
    result_mode text NOT NULL,
    result_interval_seconds integer NOT NULL,
    acting_actor_id text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX marketing_banner_presentation_events_recent_idx ON dsh.marketing_banner_presentation_events(created_at DESC);
