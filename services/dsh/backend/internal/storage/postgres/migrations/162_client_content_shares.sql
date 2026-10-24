-- One-way, private client-to-client content shares; not a chat or financial authority.
CREATE TABLE dsh.client_content_shares (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sender_actor_id text NOT NULL CHECK (length(btrim(sender_actor_id)) BETWEEN 1 AND 128),
    recipient_actor_id text NOT NULL CHECK (length(btrim(recipient_actor_id)) BETWEEN 1 AND 128),
    content_kind text NOT NULL CHECK (content_kind IN ('STORE','OFFER','PROMOTION','CONTENT')),
    content_id text NOT NULL CHECK (length(btrim(content_id)) BETWEEN 1 AND 128),
    message_code text NOT NULL CHECK (message_code IN ('LOOK','LIKE','OFFER','TRY')),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    request_hash text NOT NULL CHECK (length(request_hash)=64),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    read_at timestamptz,
    CONSTRAINT client_content_shares_distinct_actors_chk CHECK (sender_actor_id<>recipient_actor_id),
    CONSTRAINT client_content_shares_sender_idempotency_uq UNIQUE (sender_actor_id,idempotency_key)
);
CREATE INDEX client_content_shares_recipient_idx ON dsh.client_content_shares(recipient_actor_id, created_at DESC, id DESC);
CREATE INDEX client_content_shares_sender_rate_idx ON dsh.client_content_shares(sender_actor_id, created_at DESC);
-- Reuse the existing push worker without introducing a separate push service.
ALTER TABLE dsh.notification_push_outbox DROP CONSTRAINT notification_push_outbox_kind_check,
    ADD CONSTRAINT notification_push_outbox_kind_check CHECK (kind IN ('ORDER_CREATED','CAPTAIN_OFFER','CAPTAIN_ARRIVED','CLIENT_SHARE'));

CREATE TABLE dsh.client_share_blocks (
    recipient_actor_id text NOT NULL,
    sender_actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_share_blocks_pkey PRIMARY KEY (recipient_actor_id,sender_actor_id),
    CONSTRAINT client_share_blocks_distinct_chk CHECK (recipient_actor_id<>sender_actor_id)
);
