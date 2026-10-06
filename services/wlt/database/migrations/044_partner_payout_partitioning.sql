-- Partitioned Partner payout settlement.
-- A Partner payout request carries an explicit Store scope. WLT partitions the
-- request into child payouts grouped by effective beneficiary and verified
-- destination, keeps immutable per-Store allocation lines for every committed
-- payout, and never mixes two beneficiaries or two destinations in one external
-- transfer. Recipient routing stays owner-only; finance_read and payout_request
-- never change a recipient. Historical payouts and snapshots are not rewritten.

CREATE TABLE wlt.partner_payout_requests (
    id text PRIMARY KEY,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    partner_actor_id text NOT NULL,
    scope_mode text NOT NULL,
    status text NOT NULL,
    total_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT partner_payout_requests_id_chk CHECK (length(btrim(id)) BETWEEN 8 AND 128),
    CONSTRAINT partner_payout_requests_idem_chk CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT partner_payout_requests_hash_chk CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT partner_payout_requests_partner_chk CHECK (btrim(partner_actor_id) <> '' AND length(partner_actor_id) <= 128),
    CONSTRAINT partner_payout_requests_scope_chk CHECK (scope_mode IN ('FULL_AVAILABLE','SPECIFIED')),
    CONSTRAINT partner_payout_requests_status_chk CHECK (status IN ('PARTITIONED')),
    CONSTRAINT partner_payout_requests_amount_chk CHECK (total_amount_minor > 0),
    CONSTRAINT partner_payout_requests_currency_chk CHECK (currency = 'YER')
);

CREATE UNIQUE INDEX partner_payout_requests_idempotency_uq
    ON wlt.partner_payout_requests(idempotency_key);

CREATE INDEX partner_payout_requests_partner_idx
    ON wlt.partner_payout_requests(partner_actor_id, created_at DESC);

-- Child payouts belonging to one partitioned Partner payout request.
CREATE TABLE wlt.partner_payout_request_payouts (
    request_id text NOT NULL REFERENCES wlt.partner_payout_requests(id) ON DELETE RESTRICT,
    payout_id text NOT NULL UNIQUE REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    group_index integer NOT NULL,
    PRIMARY KEY (request_id, payout_id),
    CONSTRAINT partner_payout_request_payouts_group_chk CHECK (group_index >= 1)
);

-- Immutable per-Store allocation lines on every partitioned child payout.
CREATE TABLE wlt.payout_store_allocations (
    payout_id text NOT NULL REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT,
    store_id text NOT NULL,
    beneficiary_actor_id text NOT NULL,
    recipient_assignment_version bigint NOT NULL DEFAULT 0,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (payout_id, store_id),
    CONSTRAINT payout_store_allocations_store_chk CHECK (btrim(store_id) <> '' AND length(store_id) <= 128),
    CONSTRAINT payout_store_allocations_beneficiary_chk CHECK (btrim(beneficiary_actor_id) <> '' AND length(beneficiary_actor_id) <= 128),
    CONSTRAINT payout_store_allocations_assignment_version_chk CHECK (recipient_assignment_version >= 0),
    CONSTRAINT payout_store_allocations_amount_chk CHECK (amount_minor > 0),
    CONSTRAINT payout_store_allocations_currency_chk CHECK (currency = 'YER')
);

CREATE INDEX payout_store_allocations_store_idx
    ON wlt.payout_store_allocations(store_id);

-- The 042 readiness gate refused every Partner payout while any Store carried a
-- selected staff recipient (WLT02). Partitioned settlement now honors that
-- routing, so the backstop keeps only the fail-closed review gate: a Partner
-- whose Stores carry RECIPIENT_REVIEW_REQUIRED still cannot create any payout.
DROP TRIGGER IF EXISTS payout_requests_recipient_readiness_guard ON wlt.payout_requests;
DROP FUNCTION IF EXISTS wlt.guard_payout_request_recipient_readiness();

CREATE FUNCTION wlt.guard_payout_request_recipient_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.actor_type = 'partner' THEN
        IF EXISTS (
            SELECT 1 FROM wlt.store_payout_recipient_assignments a
            WHERE a.partner_actor_id = NEW.actor_id AND a.state = 'RECIPIENT_REVIEW_REQUIRED'
        ) THEN
            RAISE EXCEPTION 'payout recipient review required for partner stores' USING ERRCODE = 'WLT01';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payout_requests_recipient_review_guard
    BEFORE INSERT ON wlt.payout_requests
    FOR EACH ROW EXECUTE FUNCTION wlt.guard_payout_request_recipient_review();
