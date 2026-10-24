-- Idempotent captain-confirmed arrival at recipient; never infer from GPS alone.
CREATE TABLE dsh.captain_delivery_arrivals (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assignment_id text NOT NULL UNIQUE REFERENCES dsh.captain_assignments(id) ON DELETE RESTRICT,
    order_id text NOT NULL REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    captain_actor_id text NOT NULL CHECK (length(btrim(captain_actor_id)) BETWEEN 1 AND 128),
    arrived_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX captain_delivery_arrivals_order_idx
  ON dsh.captain_delivery_arrivals(order_id,arrived_at DESC);
ALTER TABLE dsh.notification_read_state
    DROP CONSTRAINT notification_read_state_notification_chk,
    ADD CONSTRAINT notification_read_state_notification_chk
    CHECK (notification_id ~ '^(order|captain|field|store|availability|arrival):[1-9][0-9]*$');
