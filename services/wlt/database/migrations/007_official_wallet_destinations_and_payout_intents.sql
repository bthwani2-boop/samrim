ALTER TABLE wlt.ledger_entries
    DROP CONSTRAINT ledger_entries_code_chk,
    ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN ('CAPTAIN_CASH_RECEIVABLE', 'CUSTOMER_PAYMENT_CLEARING', 'PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET', 'PLATFORM_COMMISSION_INCOME')),
    DROP CONSTRAINT ledger_entries_actor_chk,
    ADD CONSTRAINT ledger_entries_actor_chk CHECK ((account_code IN ('PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET') AND actor_type IS NOT NULL AND actor_id IS NOT NULL) OR (account_code NOT IN ('PARTNER_WALLET', 'CAPTAIN_WALLET', 'FIELD_WALLET') AND actor_type IS NULL AND actor_id IS NULL));

CREATE TABLE wlt.official_wallet_destinations (
    id text PRIMARY KEY,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    provider_key text NOT NULL,
    wallet_identifier_ciphertext text NOT NULL,
    wallet_identifier_masked text NOT NULL,
    beneficiary_name text NOT NULL,
    verification_status text NOT NULL DEFAULT 'PENDING_VERIFICATION',
    status text NOT NULL DEFAULT 'CANDIDATE',
    version integer NOT NULL,
    change_reason text NOT NULL,
    submitted_by text NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    verified_by text,
    verified_at timestamptz,
    approved_by text,
    approved_at timestamptz,
    verification_evidence_reference text NOT NULL,
    change_evidence_reference text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT official_wallet_destinations_actor_chk CHECK (actor_type IN ('partner', 'captain', 'field')),
    CONSTRAINT official_wallet_destinations_actor_id_chk CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT official_wallet_destinations_provider_chk CHECK (length(btrim(provider_key)) BETWEEN 1 AND 64),
    CONSTRAINT official_wallet_destinations_identifier_chk CHECK (length(btrim(wallet_identifier_ciphertext)) > 0 AND length(btrim(wallet_identifier_masked)) BETWEEN 4 AND 128),
    CONSTRAINT official_wallet_destinations_beneficiary_chk CHECK (length(btrim(beneficiary_name)) BETWEEN 1 AND 160),
    CONSTRAINT official_wallet_destinations_verification_chk CHECK (verification_status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')),
    CONSTRAINT official_wallet_destinations_status_chk CHECK (status IN ('CANDIDATE', 'PENDING_APPROVAL', 'ACTIVE_FOR_PAYOUT', 'SUSPENDED', 'RETIRED')),
    CONSTRAINT official_wallet_destinations_version_chk CHECK (version > 0),
    CONSTRAINT official_wallet_destinations_reason_chk CHECK (length(btrim(change_reason)) BETWEEN 1 AND 512),
    CONSTRAINT official_wallet_destinations_submitted_by_chk CHECK (length(btrim(submitted_by)) BETWEEN 1 AND 128),
    CONSTRAINT official_wallet_destinations_evidence_chk CHECK (length(btrim(verification_evidence_reference)) BETWEEN 1 AND 512 AND length(btrim(change_evidence_reference)) BETWEEN 1 AND 512),
    CONSTRAINT official_wallet_destinations_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT official_wallet_destinations_actor_version_uq UNIQUE (actor_type, actor_id, version),
    CONSTRAINT official_wallet_destinations_active_state_chk CHECK ((status = 'ACTIVE_FOR_PAYOUT' AND verification_status = 'VERIFIED') OR status <> 'ACTIVE_FOR_PAYOUT')
);

CREATE UNIQUE INDEX official_wallet_destinations_active_actor_uq
    ON wlt.official_wallet_destinations(actor_type, actor_id)
    WHERE status = 'ACTIVE_FOR_PAYOUT';
CREATE INDEX official_wallet_destinations_actor_idx
    ON wlt.official_wallet_destinations(actor_type, actor_id, version DESC);

CREATE TABLE wlt.official_wallet_destination_transitions (
    id text PRIMARY KEY,
    destination_id text NOT NULL,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    actor_id text NOT NULL,
    correlation_id text NOT NULL,
    evidence_reference text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT official_wallet_destination_transitions_destination_fk FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT,
    CONSTRAINT official_wallet_destination_transitions_operation_chk CHECK (operation IN ('VERIFY', 'ACTIVATE')),
    CONSTRAINT official_wallet_destination_transitions_key_uq UNIQUE (idempotency_key),
    CONSTRAINT official_wallet_destination_transitions_hash_chk CHECK (length(btrim(request_hash)) > 0),
    CONSTRAINT official_wallet_destination_transitions_actor_chk CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT official_wallet_destination_transitions_correlation_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128)
);

CREATE INDEX official_wallet_destination_transitions_destination_idx
    ON wlt.official_wallet_destination_transitions(destination_id, created_at DESC);

CREATE TABLE wlt.payout_requests (
    id text PRIMARY KEY,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    amount_mode text NOT NULL,
    requested_amount_minor bigint,
    resolved_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    destination_id text NOT NULL,
    destination_version integer NOT NULL,
    status text NOT NULL DEFAULT 'HELD',
    policy_version text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT payout_requests_actor_chk CHECK (actor_type IN ('partner', 'captain', 'field')),
    CONSTRAINT payout_requests_actor_id_chk CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT payout_requests_amount_mode_chk CHECK (amount_mode IN ('FULL_AVAILABLE', 'SPECIFIED')),
    CONSTRAINT payout_requests_amount_chk CHECK (resolved_amount_minor > 0 AND ((amount_mode = 'FULL_AVAILABLE' AND requested_amount_minor IS NULL) OR (amount_mode = 'SPECIFIED' AND requested_amount_minor IS NOT NULL AND requested_amount_minor > 0))),
    CONSTRAINT payout_requests_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT payout_requests_destination_version_chk CHECK (destination_version > 0),
    CONSTRAINT payout_requests_status_chk CHECK (status IN ('HELD', 'CANCELLED', 'PREPARED', 'APPROVED', 'FROZEN', 'EXECUTED', 'COMPLETED', 'EXCEPTION')),
    CONSTRAINT payout_requests_policy_chk CHECK (length(btrim(policy_version)) BETWEEN 1 AND 128),
    CONSTRAINT payout_requests_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT payout_requests_destination_fk FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT
);

CREATE INDEX payout_requests_actor_idx ON wlt.payout_requests(actor_type, actor_id, created_at DESC);

CREATE TABLE wlt.payout_holds (
    id text PRIMARY KEY,
    payout_id text NOT NULL UNIQUE,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    status text NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    released_at timestamptz,
    CONSTRAINT payout_holds_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    CONSTRAINT payout_holds_actor_chk CHECK (actor_type IN ('partner', 'captain', 'field')),
    CONSTRAINT payout_holds_actor_id_chk CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT payout_holds_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT payout_holds_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT payout_holds_status_chk CHECK (status IN ('ACTIVE', 'RELEASED', 'FINALIZED')),
    CONSTRAINT payout_holds_release_chk CHECK ((status = 'ACTIVE' AND released_at IS NULL) OR (status <> 'ACTIVE'))
);

CREATE INDEX payout_holds_actor_active_idx ON wlt.payout_holds(actor_type, actor_id, status, created_at DESC);
