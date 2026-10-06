-- Order-scoped operational messages are canonical DSH facts. Notification delivery
-- remains a projection and never becomes the conversation writer.
CREATE TABLE dsh.commerce_order_conversation_messages (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    sender_actor_id text NOT NULL,
    sender_role text NOT NULL,
    body text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_conversation_messages_order_fk
        FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE CASCADE,
    CONSTRAINT commerce_order_conversation_messages_sender_role_chk
        CHECK (sender_role IN ('client', 'partner', 'captain')),
    CONSTRAINT commerce_order_conversation_messages_actor_chk
        CHECK (length(btrim(sender_actor_id)) > 0),
    CONSTRAINT commerce_order_conversation_messages_body_chk
        CHECK (char_length(body) BETWEEN 1 AND 2000),
    CONSTRAINT commerce_order_conversation_messages_request_hash_chk
        CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT commerce_order_conversation_messages_correlation_chk
        CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128)
);

CREATE INDEX commerce_order_conversation_messages_order_idx
    ON dsh.commerce_order_conversation_messages(order_id, created_at, id);

CREATE INDEX commerce_order_conversation_messages_sender_idx
    ON dsh.commerce_order_conversation_messages(sender_actor_id, created_at DESC);

CREATE TABLE dsh.commerce_order_conversation_read_state (
    actor_id text NOT NULL,
    message_id text NOT NULL,
    read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_conversation_read_state_pkey PRIMARY KEY (actor_id, message_id),
    CONSTRAINT commerce_order_conversation_read_state_actor_chk
        CHECK (length(btrim(actor_id)) > 0),
    CONSTRAINT commerce_order_conversation_read_state_message_fk
        FOREIGN KEY (message_id) REFERENCES dsh.commerce_order_conversation_messages(id) ON DELETE CASCADE
);

CREATE INDEX commerce_order_conversation_read_state_actor_idx
    ON dsh.commerce_order_conversation_read_state(actor_id, read_at DESC, message_id);
