-- Cancellation requests are Operations support records, not Order cancellation events.
CREATE TABLE dsh.order_cancellation_requests (
  id text PRIMARY KEY DEFAULT ('cancel_request_' || replace(gen_random_uuid()::text,'-','')),
  order_id text NOT NULL REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
  client_actor_id text NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  idempotency_key text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  operator_actor_id text,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  CONSTRAINT order_cancellation_requests_state_chk CHECK(state IN ('PENDING','APPROVED','DECLINED')),
  CONSTRAINT order_cancellation_requests_reason_chk CHECK(char_length(btrim(reason)) BETWEEN 12 AND 500),
  CONSTRAINT order_cancellation_requests_decision_chk CHECK(
    (state='PENDING' AND decided_at IS NULL AND operator_actor_id IS NULL AND decision_reason IS NULL)
    OR (state IN ('APPROVED','DECLINED') AND decided_at IS NOT NULL AND operator_actor_id IS NOT NULL AND char_length(btrim(decision_reason)) BETWEEN 12 AND 500))
);
CREATE UNIQUE INDEX order_cancellation_requests_one_pending_idx
 ON dsh.order_cancellation_requests(order_id) WHERE state='PENDING';
CREATE INDEX order_cancellation_requests_pending_queue_idx
 ON dsh.order_cancellation_requests(created_at,id) WHERE state='PENDING';
CREATE INDEX order_cancellation_requests_customer_idx
 ON dsh.order_cancellation_requests(client_actor_id,created_at DESC);
