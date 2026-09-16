-- Forward-only refresh reconciliation cutover.
-- Refresh responses can be reconstructed from the durable request identity and
-- the session secret; the database stores no recoverable token plaintext.

ALTER TABLE identity_refresh_token_history
    ADD COLUMN IF NOT EXISTS refresh_request_id varchar(256);

CREATE UNIQUE INDEX IF NOT EXISTS identity_refresh_token_history_request_id_uq
    ON identity_refresh_token_history (refresh_request_id)
    WHERE refresh_request_id IS NOT NULL;
