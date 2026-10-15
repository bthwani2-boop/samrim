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
ALTER TABLE dsh.commerce_order_delivery_proofs
    DROP CONSTRAINT commerce_order_delivery_proof_material_chk;
ALTER TABLE dsh.commerce_order_delivery_proofs
    ADD CONSTRAINT commerce_order_delivery_proof_material_chk
        CHECK ((state='PENDING' AND code_ciphertext IS NOT NULL
                AND code_verifier ~ '^[0-9a-f]{64}$'
                AND code_key_id ~ '^[a-zA-Z0-9_-]{1,32}$')
            OR (state IN ('VERIFIED', 'CAPTAIN_CONFIRMED')
                AND code_ciphertext IS NULL AND code_verifier IS NULL AND code_key_id IS NULL));
