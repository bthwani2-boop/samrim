-- Order-scoped operational exceptions, not a generic CRM or a second financial ledger.
CREATE TABLE dsh.operator_order_cases (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id text NOT NULL REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
 reason text NOT NULL CONSTRAINT ops_case_reason_chk CHECK (reason IN ('PARTNER_DELAY','DISPATCH_UNAVAILABLE','DELIVERY_BLOCKED','CUSTOMER_CONTACT','PAYMENT_EXCEPTION','OTHER')),
 state text NOT NULL DEFAULT 'OPEN' CONSTRAINT ops_case_state_chk CHECK(state IN ('OPEN','IN_PROGRESS','ACTION_REQUIRED','RESOLVED')),
 priority text NOT NULL DEFAULT 'NORMAL' CONSTRAINT ops_case_priority_chk CHECK(priority IN ('NORMAL','URGENT')),
 owner_actor_id text,
 next_action text NOT NULL CONSTRAINT ops_case_next_action_chk CHECK(char_length(trim(next_action)) BETWEEN 12 AND 500),
 opened_by_actor_id text NOT NULL,
 updated_by_actor_id text NOT NULL,
 version integer NOT NULL DEFAULT 1 CONSTRAINT ops_case_version_chk CHECK(version > 0),
 resolution_note text,
 opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_at timestamptz,
 CONSTRAINT ops_case_resolution_chk CHECK ((state='RESOLVED')=(resolved_at IS NOT NULL) AND (resolved_at IS NULL OR char_length(trim(resolution_note)) BETWEEN 12 AND 1000))
);
CREATE UNIQUE INDEX ops_case_one_active_reason_uq ON dsh.operator_order_cases(order_id,reason) WHERE state<>'RESOLVED';
CREATE INDEX ops_case_order_recent_idx ON dsh.operator_order_cases(order_id,id DESC);
CREATE INDEX ops_case_work_queue_idx ON dsh.operator_order_cases(priority,opened_at,id) WHERE state<>'RESOLVED';
CREATE TABLE dsh.operator_order_case_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id bigint NOT NULL REFERENCES dsh.operator_order_cases(id) ON DELETE RESTRICT,
 action text NOT NULL CONSTRAINT ops_case_event_action_chk CHECK(action IN ('OPEN','CLAIM','ACTION_REQUIRED','NEXT_ACTION','RESOLVE')),
 actor_id text NOT NULL,
 idempotency_key text NOT NULL CONSTRAINT ops_case_event_idempotency_uq UNIQUE,
 request_hash text NOT NULL,
 correlation_id text NOT NULL,
 detail text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ops_case_event_case_idx ON dsh.operator_order_case_events(case_id,id);
