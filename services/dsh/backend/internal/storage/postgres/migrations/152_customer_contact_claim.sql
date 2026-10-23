-- One expiring operator claim on a customer contact review.
ALTER TABLE dsh.customer_order_contact_reviews
 ADD COLUMN claim_actor_id text,
 ADD COLUMN claim_expires_at timestamptz,
 ADD CONSTRAINT customer_contact_claim_pair_chk
 CHECK ((claim_actor_id IS NULL) = (claim_expires_at IS NULL));
CREATE TABLE dsh.customer_order_contact_claim_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id text NOT NULL REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
 operator_actor_id text NOT NULL,
 action text NOT NULL CHECK (action IN ('CLAIM','RELEASE')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX customer_order_contact_claim_events_idx
 ON dsh.customer_order_contact_claim_events(order_id,id);
