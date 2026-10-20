-- Snapshot one immutable cancellation entitlement for each Order at creation.
-- Existing Orders stay OPERATIONS_ONLY; historical policies must not be guessed.
ALTER TABLE dsh.commercial_store_types
  ADD COLUMN cancellation_mode text NOT NULL DEFAULT 'OPERATIONS_ONLY',
  ADD CONSTRAINT commercial_store_types_cancellation_mode_chk
    CHECK (cancellation_mode IN ('OPERATIONS_ONLY', 'CLIENT_BEFORE_ACCEPTANCE'));

ALTER TABLE dsh.commerce_orders
  ADD COLUMN cancellation_mode text NOT NULL DEFAULT 'OPERATIONS_ONLY',
  ADD COLUMN cancellation_policy_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT commerce_orders_cancellation_mode_chk
    CHECK (cancellation_mode IN ('OPERATIONS_ONLY', 'CLIENT_BEFORE_ACCEPTANCE')),
  ADD CONSTRAINT commerce_orders_cancellation_policy_version_chk
    CHECK (cancellation_policy_version >= 0);

-- Preserve business decision reason distinct from payment hold/cancellation effect.
ALTER TABLE dsh.commerce_order_audit
  ADD COLUMN decision_reason text,
  ADD CONSTRAINT commerce_order_audit_decision_reason_chk
    CHECK (decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 12 AND 500);

CREATE TABLE dsh.store_type_cancellation_policy_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_type_id text NOT NULL REFERENCES dsh.commercial_store_types(id) ON DELETE RESTRICT,
  previous_mode text NOT NULL,
  resulting_mode text NOT NULL,
  expected_version integer NOT NULL,
  resulting_version integer NOT NULL,
  acting_actor_id text NOT NULL,
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cancellation_policy_audit_mode_chk CHECK (
    previous_mode IN ('OPERATIONS_ONLY', 'CLIENT_BEFORE_ACCEPTANCE') AND
    resulting_mode IN ('OPERATIONS_ONLY', 'CLIENT_BEFORE_ACCEPTANCE')),
  CONSTRAINT cancellation_policy_audit_version_chk CHECK (expected_version > 0 AND resulting_version=expected_version+1),
  CONSTRAINT cancellation_policy_audit_reason_chk CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500)
);
CREATE INDEX store_type_cancellation_policy_audit_type_idx ON
  dsh.store_type_cancellation_policy_audit (store_type_id,created_at DESC);
