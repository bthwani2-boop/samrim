ALTER TABLE wlt.approved_payout_snapshots
    ADD CONSTRAINT approved_payout_snapshots_prepare_approve_sod_chk
    CHECK (approved_by IS NULL OR prepared_by <> approved_by);

ALTER TABLE wlt.settlement_batches
    ADD CONSTRAINT settlement_batches_create_approve_sod_chk
    CHECK (approved_by IS NULL OR created_by <> approved_by),
    ADD CONSTRAINT settlement_batches_approve_freeze_sod_chk
    CHECK (frozen_by IS NULL OR approved_by IS NULL OR approved_by <> frozen_by);

ALTER TABLE wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_execute_verify_sod_chk
    CHECK (verified_by IS NULL OR executed_by <> verified_by);
