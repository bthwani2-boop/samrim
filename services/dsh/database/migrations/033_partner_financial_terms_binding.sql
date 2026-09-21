ALTER TABLE dsh.joining_cases
    ADD COLUMN commission_rate_bps integer,
    ADD COLUMN settlement_period text,
    ADD COLUMN financial_profile_id text,
    ADD COLUMN financial_profile_state text NOT NULL DEFAULT 'REQUIRED';

ALTER TABLE dsh.joining_cases
    ADD CONSTRAINT joining_cases_commission_rate_chk CHECK (commission_rate_bps IS NULL OR commission_rate_bps BETWEEN 0 AND 10000),
    ADD CONSTRAINT joining_cases_settlement_period_chk CHECK (settlement_period IS NULL OR settlement_period IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    ADD CONSTRAINT joining_cases_financial_profile_state_chk CHECK (financial_profile_state IN ('REQUIRED', 'PENDING_BINDING', 'ACTIVE', 'FAILED')),
    ADD CONSTRAINT joining_cases_financial_terms_pair_chk CHECK ((commission_rate_bps IS NULL AND settlement_period IS NULL) OR (commission_rate_bps IS NOT NULL AND settlement_period IS NOT NULL));

CREATE UNIQUE INDEX joining_cases_financial_profile_id_uq
    ON dsh.joining_cases(financial_profile_id) WHERE financial_profile_id IS NOT NULL;
CREATE INDEX joining_cases_financial_profile_state_idx
    ON dsh.joining_cases(financial_profile_state, updated_at ASC, id ASC);

CREATE TABLE dsh.joining_case_financial_profile_outbox (
    id text PRIMARY KEY,
    case_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    partner_actor_id text NOT NULL,
    origin text NOT NULL,
    commission_rate_bps integer NOT NULL,
    settlement_period text NOT NULL,
    financial_profile_id text,
    state text NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT joining_case_financial_outbox_case_uq UNIQUE (case_id),
    CONSTRAINT joining_case_financial_outbox_idempotency_uq UNIQUE (idempotency_key),
    CONSTRAINT joining_case_financial_outbox_case_fk FOREIGN KEY (case_id) REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT,
    CONSTRAINT joining_case_financial_outbox_origin_chk CHECK (origin IN ('field', 'control_panel')),
    CONSTRAINT joining_case_financial_outbox_commission_chk CHECK (commission_rate_bps BETWEEN 0 AND 10000),
    CONSTRAINT joining_case_financial_outbox_settlement_chk CHECK (settlement_period IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    CONSTRAINT joining_case_financial_outbox_state_chk CHECK (state IN ('PENDING', 'ACTIVE', 'FAILED')),
    CONSTRAINT joining_case_financial_outbox_attempts_chk CHECK (attempts >= 0)
);

CREATE INDEX joining_case_financial_outbox_pending_idx
    ON dsh.joining_case_financial_profile_outbox(state, next_attempt_at ASC, created_at ASC, id ASC);
