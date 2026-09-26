ALTER TABLE wlt.official_wallet_destinations
    DROP CONSTRAINT official_wallet_destinations_actor_chk,
    ADD CONSTRAINT official_wallet_destinations_actor_chk CHECK (actor_type IN ('customer', 'partner', 'captain', 'field')),
    DROP CONSTRAINT official_wallet_destinations_beneficiary_chk,
    ADD CONSTRAINT official_wallet_destinations_beneficiary_chk CHECK (length(btrim(beneficiary_name)) BETWEEN 1 AND 320);

ALTER TABLE wlt.payout_requests
    DROP CONSTRAINT payout_requests_actor_chk,
    ADD CONSTRAINT payout_requests_actor_chk CHECK (actor_type IN ('customer', 'partner', 'captain', 'field'));

ALTER TABLE wlt.payout_holds
    DROP CONSTRAINT payout_holds_actor_chk,
    ADD CONSTRAINT payout_holds_actor_chk CHECK (actor_type IN ('customer', 'partner', 'captain', 'field'));

ALTER TABLE wlt.approved_payout_snapshots
    DROP CONSTRAINT approved_payout_snapshots_actor_chk,
    ADD CONSTRAINT approved_payout_snapshots_actor_chk CHECK (actor_type IN ('customer', 'partner', 'captain', 'field')),
    DROP CONSTRAINT approved_payout_snapshots_beneficiary_chk,
    ADD CONSTRAINT approved_payout_snapshots_beneficiary_chk CHECK (length(btrim(beneficiary_name)) BETWEEN 1 AND 320);

CREATE TABLE wlt.customer_manual_withdrawal_intakes (
    id text PRIMARY KEY,
    customer_actor_id text NOT NULL,
    provider_key text NOT NULL,
    wallet_identifier_ciphertext text NOT NULL,
    wallet_identifier_masked text NOT NULL,
    beneficiary_name text NOT NULL,
    beneficiary_identity_version integer NOT NULL,
    request_reason text NOT NULL,
    request_evidence_document_id text NOT NULL REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'REQUESTED',
    destination_id text REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT,
    payout_id text UNIQUE REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    requested_by text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finance_actor_id text,
    resolved_at timestamptz,
    resolution_reason text,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT customer_withdrawal_intakes_customer_chk CHECK (length(btrim(customer_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT customer_withdrawal_intakes_provider_chk CHECK (length(btrim(provider_key)) BETWEEN 1 AND 64),
    CONSTRAINT customer_withdrawal_intakes_wallet_chk CHECK (length(btrim(wallet_identifier_ciphertext)) > 0 AND length(btrim(wallet_identifier_masked)) BETWEEN 4 AND 128),
    CONSTRAINT customer_withdrawal_intakes_name_chk CHECK (length(btrim(beneficiary_name)) BETWEEN 1 AND 320 AND beneficiary_identity_version > 0),
    CONSTRAINT customer_withdrawal_intakes_reason_chk CHECK (length(btrim(request_reason)) BETWEEN 1 AND 512),
    CONSTRAINT customer_withdrawal_intakes_status_chk CHECK (status IN ('REQUESTED','DESTINATION_PENDING','PAYOUT_HELD','REJECTED','COMPLETED')),
    CONSTRAINT customer_withdrawal_intakes_state_chk CHECK ((status='REQUESTED' AND destination_id IS NULL AND payout_id IS NULL AND finance_actor_id IS NULL AND resolved_at IS NULL) OR (status='DESTINATION_PENDING' AND destination_id IS NOT NULL AND payout_id IS NULL AND finance_actor_id IS NOT NULL AND resolved_at IS NOT NULL) OR (status IN ('PAYOUT_HELD','COMPLETED') AND destination_id IS NOT NULL AND payout_id IS NOT NULL AND finance_actor_id IS NOT NULL AND resolved_at IS NOT NULL) OR (status='REJECTED' AND finance_actor_id IS NOT NULL AND resolved_at IS NOT NULL AND length(btrim(resolution_reason)) BETWEEN 1 AND 512)),
    CONSTRAINT customer_withdrawal_intakes_operator_chk CHECK (length(btrim(requested_by)) BETWEEN 1 AND 128 AND (finance_actor_id IS NULL OR length(btrim(finance_actor_id)) BETWEEN 1 AND 128)),
    CONSTRAINT customer_withdrawal_intakes_resolution_chk CHECK (resolution_reason IS NULL OR length(btrim(resolution_reason)) BETWEEN 1 AND 512),
    CONSTRAINT customer_withdrawal_intakes_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT customer_withdrawal_intakes_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE INDEX customer_withdrawal_intakes_queue_idx ON wlt.customer_manual_withdrawal_intakes(status, requested_at DESC, id DESC);
CREATE INDEX customer_withdrawal_intakes_customer_idx ON wlt.customer_manual_withdrawal_intakes(customer_actor_id, requested_at DESC, id DESC);

CREATE TABLE wlt.customer_manual_withdrawal_events (
    id text PRIMARY KEY,
    intake_id text NOT NULL REFERENCES wlt.customer_manual_withdrawal_intakes(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    acting_actor_id text NOT NULL,
    reason text NOT NULL DEFAULT '',
    evidence_document_id text REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT,
    payout_id text REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT customer_withdrawal_events_type_chk CHECK (event_type IN ('OPS_REQUESTED','DESTINATION_PREPARED','DESTINATION_VERIFIED','DESTINATION_ACTIVATED','FINANCE_ACCEPTED','FINANCE_REJECTED','PAYOUT_COMPLETED')),
    CONSTRAINT customer_withdrawal_events_actor_chk CHECK (length(btrim(acting_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT customer_withdrawal_events_reason_chk CHECK (length(reason) <= 512),
    CONSTRAINT customer_withdrawal_events_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT customer_withdrawal_events_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE INDEX customer_manual_withdrawal_events_intake_idx ON wlt.customer_manual_withdrawal_events(intake_id, created_at, id);
