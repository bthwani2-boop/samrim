CREATE TABLE demo_orders (
    id text PRIMARY KEY,
    actor_id text NOT NULL,
    total_minor bigint NOT NULL CHECK (total_minor >= 0)
);
