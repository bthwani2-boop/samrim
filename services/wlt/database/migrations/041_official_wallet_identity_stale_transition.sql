ALTER TABLE wlt.official_wallet_destination_transitions
    DROP CONSTRAINT official_wallet_destination_transitions_operation_chk,
    ADD CONSTRAINT official_wallet_destination_transitions_operation_chk
        CHECK (operation IN ('VERIFY', 'ACTIVATE', 'IDENTITY_STALE'));
