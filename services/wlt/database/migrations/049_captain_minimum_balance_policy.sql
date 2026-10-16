-- Captain-wide dispatch eligibility. No numeric default: an absent active policy
-- means the new minimum has not yet been configured by an operator.
CREATE TABLE wlt.captain_minimum_balance_policies (
    id text PRIMARY KEY,
    version integer NOT NULL CHECK (version > 0),
    minimum_available_minor bigint NOT NULL CHECK (minimum_available_minor >= 0),
    currency text NOT NULL DEFAULT 'YER' CHECK (currency = 'YER'),
    state text NOT NULL CHECK (state IN ('ACTIVE','RETIRED')),
    created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 128),
    change_reason text NOT NULL CHECK (length(btrim(change_reason)) BETWEEN 5 AND 500),
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    retired_at timestamptz
);
CREATE UNIQUE INDEX captain_minimum_balance_one_active
  ON wlt.captain_minimum_balance_policies(state) WHERE state='ACTIVE';
CREATE UNIQUE INDEX captain_minimum_balance_versions
  ON wlt.captain_minimum_balance_policies(version);
