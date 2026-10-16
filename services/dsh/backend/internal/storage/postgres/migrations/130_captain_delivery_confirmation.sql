-- Delivery by an authenticated assigned Captain no longer requires a
-- customer-entered code. Keep VERIFIED exclusively for actual code proof;
-- CAPTAIN_CONFIRMED records an actor-attested delivery, not independent proof.
ALTER TABLE dsh.commerce_order_delivery_proofs
    DROP CONSTRAINT commerce_order_delivery_proof_state_chk;
ALTER TABLE dsh.commerce_order_delivery_proofs
    ADD CONSTRAINT commerce_order_delivery_proof_state_chk
        CHECK (state IN ('PENDING', 'VERIFIED', 'CAPTAIN_CONFIRMED'));
ALTER TABLE dsh.commerce_order_delivery_proofs
    DROP CONSTRAINT commerce_order_delivery_proof_verified_chk;
ALTER TABLE dsh.commerce_order_delivery_proofs
    ADD CONSTRAINT commerce_order_delivery_proof_verified_chk
        CHECK ((state='PENDING' AND verified_by IS NULL AND verified_at IS NULL)
            OR (state IN ('VERIFIED', 'CAPTAIN_CONFIRMED') AND verified_by IS NOT NULL AND verified_at IS NOT NULL));
-- The material constraint belongs to the post-encryption cutover: before that
-- phase a fresh database still contains the legacy plaintext proof columns.
