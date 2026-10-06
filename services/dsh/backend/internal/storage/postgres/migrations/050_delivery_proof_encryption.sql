-- Application-owned cutover migrates the existing plaintext and legacy digests
-- with the DSH proof keyring, then removes the legacy columns atomically.
ALTER TABLE dsh.commerce_order_delivery_proofs
    ADD COLUMN code_ciphertext text,
    ADD COLUMN code_verifier text,
    ADD COLUMN code_key_id text;
