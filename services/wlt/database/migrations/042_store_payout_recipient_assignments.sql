-- Store payout-recipient assignment (PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT).
-- WLT owns the canonical STORE -> effective payout-recipient beneficiary relationship.
-- DEFAULT_OWNER needs no record: the absence of a row routes future unpinned payout
-- intents to the Partner owner. Rows exist only for explicit owner selections
-- (SELECTED_VERIFIED_STAFF) and for fail-closed review (RECIPIENT_REVIEW_REQUIRED).
-- One effective row per Store; every transition is owner-initiated (or fail-closed
-- from canonical eligibility facts), versioned and audited. No transition rewrites a
-- committed payout snapshot.

CREATE TABLE wlt.store_payout_recipient_assignments (
    id text PRIMARY KEY,
    store_id text NOT NULL,
    partner_actor_id text NOT NULL,
    beneficiary_actor_type text NOT NULL DEFAULT 'partner',
    beneficiary_actor_id text NOT NULL,
    state text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    assigned_by_actor_id text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_payout_recipient_assignments_store_chk CHECK (length(btrim(store_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_payout_recipient_assignments_partner_chk CHECK (length(btrim(partner_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_payout_recipient_assignments_beneficiary_type_chk CHECK (beneficiary_actor_type = 'partner'),
    CONSTRAINT store_payout_recipient_assignments_beneficiary_chk CHECK (length(btrim(beneficiary_actor_id)) BETWEEN 1 AND 128 AND beneficiary_actor_id <> partner_actor_id),
    CONSTRAINT store_payout_recipient_assignments_state_chk CHECK (state IN ('SELECTED_VERIFIED_STAFF', 'RECIPIENT_REVIEW_REQUIRED')),
    CONSTRAINT store_payout_recipient_assignments_version_chk CHECK (version >= 1),
    CONSTRAINT store_payout_recipient_assignments_assigned_by_chk CHECK (assigned_by_actor_id = partner_actor_id),
    CONSTRAINT store_payout_recipient_assignments_review_assignment_chk CHECK (state <> 'RECIPIENT_REVIEW_REQUIRED' OR (idempotency_key = 'WLT_SYSTEM_FAIL_CLOSED' AND request_hash = '0000000000000000000000000000000000000000000000000000000000000000')),
    CONSTRAINT store_payout_recipient_assignments_reason_chk CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    CONSTRAINT store_payout_recipient_assignments_idempotency_chk CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT store_payout_recipient_assignments_hash_chk CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT store_payout_recipient_assignments_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE UNIQUE INDEX store_payout_recipient_assignments_store_uq
    ON wlt.store_payout_recipient_assignments(store_id);
CREATE INDEX store_payout_recipient_assignments_partner_idx
    ON wlt.store_payout_recipient_assignments(partner_actor_id, store_id);
CREATE INDEX store_payout_recipient_assignments_beneficiary_idx
    ON wlt.store_payout_recipient_assignments(beneficiary_actor_id, state);

CREATE TABLE wlt.store_payout_recipient_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id text NOT NULL,
    assignment_id text NOT NULL,
    event_type text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    from_version integer,
    result_version integer NOT NULL,
    acting_actor_id text NOT NULL,
    beneficiary_actor_id text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_payout_recipient_events_store_chk CHECK (length(btrim(store_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_payout_recipient_events_assignment_chk CHECK (length(btrim(assignment_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_payout_recipient_events_type_chk CHECK (event_type IN ('STAFF_SELECTED', 'REVERTED_TO_OWNER', 'MARKED_REVIEW_REQUIRED', 'REASSIGNED_STAFF')),
    CONSTRAINT store_payout_recipient_events_state_chk CHECK (to_state IN ('SELECTED_VERIFIED_STAFF', 'RECIPIENT_REVIEW_REQUIRED', 'DEFAULT_OWNER') AND (from_state IS NULL OR from_state IN ('SELECTED_VERIFIED_STAFF', 'RECIPIENT_REVIEW_REQUIRED', 'DEFAULT_OWNER'))),
    CONSTRAINT store_payout_recipient_events_actor_chk CHECK (length(btrim(acting_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_payout_recipient_events_beneficiary_chk CHECK (length(btrim(beneficiary_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_payout_recipient_events_reason_chk CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    CONSTRAINT store_payout_recipient_events_hash_chk CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT store_payout_recipient_events_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE INDEX store_payout_recipient_events_history_idx
    ON wlt.store_payout_recipient_events(store_id, created_at, id);

CREATE FUNCTION wlt.reject_store_payout_recipient_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'store payout recipient events are immutable';
END;
$$;
CREATE TRIGGER store_payout_recipient_events_immutable
    BEFORE UPDATE OR DELETE ON wlt.store_payout_recipient_events
    FOR EACH ROW EXECUTE FUNCTION wlt.reject_store_payout_recipient_event_mutation();

-- Partner-level payout readiness gate: a Partner whose Stores carry a
-- RECIPIENT_REVIEW_REQUIRED assignment has future payout readiness blocked until the
-- owner selects or reconfirms a legal recipient. Enforced as a constraint trigger so
-- the gate cannot be bypassed by any writer path.
CREATE FUNCTION wlt.guard_payout_request_recipient_readiness() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.actor_type = 'partner' THEN
        IF EXISTS (
            SELECT 1 FROM wlt.store_payout_recipient_assignments a
            WHERE a.partner_actor_id = NEW.actor_id AND a.state = 'RECIPIENT_REVIEW_REQUIRED'
        ) THEN
            RAISE EXCEPTION 'payout recipient review required for partner stores' USING ERRCODE = 'WLT01';
        END IF;
        IF EXISTS (
            SELECT 1 FROM wlt.store_payout_recipient_assignments a
            WHERE a.partner_actor_id = NEW.actor_id AND a.state = 'SELECTED_VERIFIED_STAFF'
        ) THEN
            RAISE EXCEPTION 'partner store payout routing selected; partitioned settlement required' USING ERRCODE = 'WLT02';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER payout_requests_recipient_readiness_guard
    BEFORE INSERT ON wlt.payout_requests
    FOR EACH ROW EXECUTE FUNCTION wlt.guard_payout_request_recipient_readiness();
