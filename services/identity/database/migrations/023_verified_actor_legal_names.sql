CREATE TABLE identity_actor_legal_name_versions (
    actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE RESTRICT,
    version integer NOT NULL,
    given_name text NOT NULL,
    second_name text NOT NULL,
    third_name text NOT NULL,
    family_name text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING_VERIFICATION',
    source text NOT NULL DEFAULT 'GOVERNED_IDENTITY_DOCUMENT_REVIEW',
    evidence_reference text NOT NULL,
    submitted_by_actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE RESTRICT,
    submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    verified_by_actor_id text REFERENCES identity_actors(id) ON DELETE RESTRICT,
    verified_at timestamptz,
    verification_evidence_reference text,
    PRIMARY KEY (actor_id, version),
    CONSTRAINT identity_actor_legal_name_version_chk CHECK (version > 0),
    CONSTRAINT identity_actor_legal_name_parts_chk CHECK (
        length(btrim(given_name)) BETWEEN 1 AND 80 AND
        length(btrim(second_name)) BETWEEN 1 AND 80 AND
        length(btrim(third_name)) BETWEEN 1 AND 80 AND
        length(btrim(family_name)) BETWEEN 1 AND 80
    ),
    CONSTRAINT identity_actor_legal_name_status_chk CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')),
    CONSTRAINT identity_actor_legal_name_source_chk CHECK (source = 'GOVERNED_IDENTITY_DOCUMENT_REVIEW'),
    CONSTRAINT identity_actor_legal_name_evidence_chk CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 512),
    CONSTRAINT identity_actor_legal_name_verified_chk CHECK (
        (status = 'VERIFIED' AND verified_by_actor_id IS NOT NULL AND verified_at IS NOT NULL AND length(btrim(verification_evidence_reference)) BETWEEN 1 AND 512 AND verified_by_actor_id <> submitted_by_actor_id)
        OR (status <> 'VERIFIED' AND verified_by_actor_id IS NULL AND verified_at IS NULL AND verification_evidence_reference IS NULL)
    )
);

CREATE TABLE identity_actor_legal_names (
    actor_id text PRIMARY KEY REFERENCES identity_actors(id) ON DELETE RESTRICT,
    current_version integer NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_actor_legal_names_current_fk FOREIGN KEY (actor_id, current_version) REFERENCES identity_actor_legal_name_versions(actor_id, version) ON DELETE RESTRICT
);

CREATE TABLE identity_actor_legal_name_events (
    id text PRIMARY KEY,
    actor_id text NOT NULL,
    version integer NOT NULL,
    event_type text NOT NULL,
    acting_actor_id text NOT NULL REFERENCES identity_actors(id) ON DELETE RESTRICT,
    evidence_reference text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identity_actor_legal_name_events_version_fk FOREIGN KEY (actor_id, version) REFERENCES identity_actor_legal_name_versions(actor_id, version) ON DELETE RESTRICT,
    CONSTRAINT identity_actor_legal_name_events_type_chk CHECK (event_type IN ('LEGAL_NAME_SUBMITTED', 'LEGAL_NAME_VERIFIED')),
    CONSTRAINT identity_actor_legal_name_events_evidence_chk CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 512),
    CONSTRAINT identity_actor_legal_name_events_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT identity_actor_legal_name_events_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE INDEX identity_actor_legal_name_versions_latest_idx ON identity_actor_legal_name_versions(actor_id, version DESC);
CREATE INDEX identity_actor_legal_name_events_actor_idx ON identity_actor_legal_name_events(actor_id, created_at DESC);
