-- Actor-scoped device registry and durable at-least-once push outbox.
-- Tokens are delivery secrets; never return them in read APIs or logs.
CREATE TABLE dsh.notification_push_devices (
    installation_id text PRIMARY KEY CHECK (installation_id ~ '^[0-9a-f-]{36}$'),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    actor_role text NOT NULL CHECK (actor_role IN ('client','partner','captain')),
    expo_push_token text NOT NULL CHECK (length(expo_push_token) BETWEEN 20 AND 256),
    tone text NOT NULL DEFAULT 'classic' CHECK (tone IN ('classic','soft','urgent')),
    registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    enabled boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX notification_push_token_uq ON dsh.notification_push_devices(expo_push_token);
CREATE INDEX notification_push_actor_idx ON dsh.notification_push_devices(actor_id,actor_role) WHERE enabled;

CREATE TABLE dsh.notification_push_outbox (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    installation_id text NOT NULL REFERENCES dsh.notification_push_devices(installation_id) ON DELETE CASCADE,
    notification_id text NOT NULL,
    order_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('ORDER_CREATED','CAPTAIN_OFFER','CAPTAIN_ARRIVED')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    locked_until timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','discarded','failed')),
    sent_at timestamptz,
    ticket_id text,
    next_receipt_at timestamptz,
    receipt_checked_at timestamptz,
    receipt_status text CHECK (receipt_status IS NULL OR receipt_status IN ('ok','error','missing')),
    CONSTRAINT push_once_per_installation_event UNIQUE (installation_id,notification_id)
);
CREATE INDEX push_outbox_due_idx ON dsh.notification_push_outbox(next_attempt_at,id)
    WHERE state='pending';

CREATE INDEX push_receipt_due_idx ON dsh.notification_push_outbox(next_receipt_at,id)
    WHERE state='sent' AND receipt_checked_at IS NULL AND ticket_id IS NOT NULL;
