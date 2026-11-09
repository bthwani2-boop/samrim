-- Operator-adjustable availability for new Store enrollment only.
-- Publication and finance retain their separate owner-backed gates.
CREATE TABLE dsh.store_joining_policies (
    relation_model text PRIMARY KEY
        CHECK (relation_model IN ('BTHWANI_PARTNER','INDEPENDENT_STORE')),
    enrollment_enabled boolean NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by_actor_id text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500)
);
INSERT INTO dsh.store_joining_policies
(relation_model,enrollment_enabled,updated_by_actor_id,reason)
VALUES
('BTHWANI_PARTNER',true,'SYSTEM','Initial marketplace enrollment is open'),
('INDEPENDENT_STORE',true,'SYSTEM','Initial independent drafts are permitted');

CREATE TABLE dsh.store_joining_policy_events (
    idempotency_key text PRIMARY KEY,
    relation_model text NOT NULL REFERENCES dsh.store_joining_policies(relation_model),
    request_hash text NOT NULL,
    expected_version integer NOT NULL CHECK (expected_version > 0),
    result_version integer NOT NULL CHECK (result_version > expected_version),
    enrollment_enabled boolean NOT NULL,
    actor_id text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX store_joining_policy_events_model_idx
ON dsh.store_joining_policy_events(relation_model,created_at DESC);
