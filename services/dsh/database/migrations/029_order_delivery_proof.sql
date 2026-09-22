-- Delivery proof is a DSH-owned order invariant. The client may read the
-- current code through an actor-scoped projection; completion verifies only
-- the digest and records the verifying Captain.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE dsh.commerce_order_delivery_proofs (
    order_id text PRIMARY KEY,
    client_actor_id text NOT NULL,
    code text NOT NULL,
    code_hash text NOT NULL,
    state text NOT NULL DEFAULT 'PENDING',
    verified_by text,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_order_delivery_proof_order_fk
        FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE CASCADE,
    CONSTRAINT commerce_order_delivery_proof_code_hash_chk
        CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT commerce_order_delivery_proof_code_chk
        CHECK (code ~ '^[0-9]{6}$'),
    CONSTRAINT commerce_order_delivery_proof_state_chk
        CHECK (state IN ('PENDING', 'VERIFIED')),
    CONSTRAINT commerce_order_delivery_proof_verified_chk
        CHECK ((state = 'PENDING' AND verified_by IS NULL AND verified_at IS NULL)
            OR (state = 'VERIFIED' AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE INDEX commerce_order_delivery_proofs_client_idx
    ON dsh.commerce_order_delivery_proofs(client_actor_id, created_at DESC);

INSERT INTO dsh.commerce_order_delivery_proofs(order_id, client_actor_id, code, code_hash, state, verified_by, verified_at)
SELECT o.id,
       o.client_actor_id,
       generated.code,
       encode(digest(o.id || '|' || generated.code, 'sha256'), 'hex'),
       CASE WHEN o.state = 'DELIVERED' THEN 'VERIFIED' ELSE 'PENDING' END,
       CASE WHEN o.state = 'DELIVERED' THEN 'migration-029' ELSE NULL END,
       CASE WHEN o.state = 'DELIVERED' THEN clock_timestamp() ELSE NULL END
FROM dsh.commerce_orders o
CROSS JOIN LATERAL (SELECT lpad((100000 + floor(random() * 900000))::bigint::text, 6, '0') AS code) generated
WHERE NOT EXISTS (SELECT 1 FROM dsh.commerce_order_delivery_proofs p WHERE p.order_id = o.id);
