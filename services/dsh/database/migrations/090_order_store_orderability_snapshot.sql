CREATE TABLE dsh.commerce_order_store_orderability_snapshots (
    order_id text PRIMARY KEY REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    availability_version integer NOT NULL,
    orderability_state text NOT NULL,
    evaluated_at timestamptz NOT NULL,
    CONSTRAINT commerce_order_store_orderability_version_chk CHECK (availability_version > 0),
    CONSTRAINT commerce_order_store_orderability_state_chk CHECK (orderability_state = 'OPEN_FOR_ORDERS')
);

COMMENT ON TABLE dsh.commerce_order_store_orderability_snapshots IS
    'Immutable checkout evidence for the current DSH Store orderability decision.';
