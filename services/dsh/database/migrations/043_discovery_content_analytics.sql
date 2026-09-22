CREATE TABLE dsh.discovery_content_events (
    id text PRIMARY KEY,
    client_event_id text NOT NULL UNIQUE,
    content_id text NOT NULL,
    event_type text NOT NULL,
    client_session_id text NOT NULL,
    client_actor_id text,
    order_id text,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT discovery_content_events_content_fk FOREIGN KEY (content_id) REFERENCES dsh.discovery_content(id) ON DELETE RESTRICT,
    CONSTRAINT discovery_content_events_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT discovery_content_events_type_chk CHECK (event_type IN ('IMPRESSION', 'CLICK', 'CONVERSION')),
    CONSTRAINT discovery_content_events_session_chk CHECK (length(btrim(client_session_id)) BETWEEN 16 AND 128),
    CONSTRAINT discovery_content_events_conversion_chk CHECK ((event_type = 'CONVERSION' AND order_id IS NOT NULL AND client_actor_id IS NOT NULL) OR (event_type <> 'CONVERSION' AND order_id IS NULL)),
    CONSTRAINT discovery_content_events_actor_chk CHECK (client_actor_id IS NULL OR length(btrim(client_actor_id)) BETWEEN 1 AND 128)
);

CREATE INDEX discovery_content_events_content_idx
    ON dsh.discovery_content_events(content_id, event_type, occurred_at DESC);
CREATE UNIQUE INDEX discovery_content_events_conversion_order_uq
    ON dsh.discovery_content_events(content_id, order_id)
    WHERE event_type = 'CONVERSION';
