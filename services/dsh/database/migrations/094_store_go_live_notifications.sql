CREATE TABLE dsh.store_go_live_notifications (
    id bigserial PRIMARY KEY,
    actor_id text NOT NULL,
    actor_role text NOT NULL,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_go_live_notifications_actor_chk CHECK (length(btrim(actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT store_go_live_notifications_role_chk CHECK (actor_role IN ('partner', 'field')),
    CONSTRAINT store_go_live_notifications_event_chk CHECK (
        (actor_role='partner' AND event_type='store_published_handoff') OR
        (actor_role='field' AND event_type IN ('field_mission_completed', 'field_acquisition_reward_posted'))
    ),
    CONSTRAINT store_go_live_notifications_recipient_uq UNIQUE (store_id, actor_id, actor_role, event_type)
);

CREATE INDEX store_go_live_notifications_actor_idx
    ON dsh.store_go_live_notifications(actor_id, actor_role, created_at DESC, id DESC);

ALTER TABLE dsh.notification_read_state
    DROP CONSTRAINT notification_read_state_notification_chk,
    ADD CONSTRAINT notification_read_state_notification_chk
        CHECK (notification_id ~ '^(order|captain|field|store):[1-9][0-9]*$');
