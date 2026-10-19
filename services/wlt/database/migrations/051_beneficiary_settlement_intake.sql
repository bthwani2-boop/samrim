-- A pre-execution settlement intake is not a payout, hold, or external transfer.
-- The canonical payout state machine remains unchanged until Finance verifies a destination.
CREATE TABLE wlt.beneficiary_settlement_intakes (
  id text PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('field','captain','partner')),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
  requested_by text NOT NULL CHECK (length(btrim(requested_by)) BETWEEN 1 AND 128),
  amount_mode text NOT NULL CHECK (amount_mode IN ('FULL_AVAILABLE','SPECIFIED')),
  requested_amount_minor bigint,
  resolved_amount_minor bigint NOT NULL CHECK (resolved_amount_minor > 0),
  currency text NOT NULL DEFAULT 'YER' CHECK (currency='YER'),
  store_allocations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(store_allocations)='array'),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','CANCELLED','CONVERTED')),
  payout_reference text,
  cancelled_by text,
  cancellation_reason text,
  cancelled_at timestamptz,
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((amount_mode='FULL_AVAILABLE' AND requested_amount_minor IS NULL) OR
         (amount_mode='SPECIFIED' AND requested_amount_minor > 0)),
  CHECK ((status='CONVERTED' AND payout_reference IS NOT NULL AND length(btrim(payout_reference)) > 0 AND cancelled_at IS NULL) OR
         (status='REQUESTED' AND payout_reference IS NULL AND cancelled_at IS NULL) OR
         (status='CANCELLED' AND payout_reference IS NULL AND cancelled_at IS NOT NULL AND length(btrim(cancelled_by))>0 AND length(btrim(cancellation_reason))>0))
);
CREATE UNIQUE INDEX beneficiary_settlement_intakes_one_open_per_actor
  ON wlt.beneficiary_settlement_intakes(actor_type,actor_id)
  WHERE status='REQUESTED';
CREATE INDEX beneficiary_settlement_intakes_queue_idx
  ON wlt.beneficiary_settlement_intakes(status,created_at DESC,id DESC);
