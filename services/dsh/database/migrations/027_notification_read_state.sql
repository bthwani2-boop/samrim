-- Notifications are a read-state projection over the canonical commerce and
-- Captain audit streams.  The DSH does not introduce a second event store.
CREATE TABLE dsh.notification_read_state (
    actor_id text NOT NULL,
    notification_id text NOT NULL,
    read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT notification_read_state_pkey PRIMARY KEY (actor_id, notification_id),
    CONSTRAINT notification_read_state_actor_chk CHECK (length(btrim(actor_id)) > 0),
    CONSTRAINT notification_read_state_notification_chk CHECK (notification_id ~ '^(order|captain):[1-9][0-9]*$')
);

CREATE INDEX notification_read_state_actor_idx
    ON dsh.notification_read_state(actor_id, read_at DESC, notification_id);
