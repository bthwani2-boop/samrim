ALTER TABLE wlt.payout_audit_events
    DROP CONSTRAINT payout_audit_events_event_chk,
    ADD CONSTRAINT payout_audit_events_event_chk CHECK (event_type IN (
        'PAYOUT_PREPARED',
        'PAYOUT_APPROVED',
        'PAYOUT_CANCELLED',
        'BATCH_CREATED',
        'BATCH_APPROVED',
        'BATCH_FROZEN',
        'TRANSFER_EXECUTED',
        'TRANSFER_VERIFIED',
        'TRANSFER_RECONCILED',
        'PAYOUT_COMPLETED',
        'FINANCE_EVIDENCE_UPLOADED',
        'SETTLEMENT_STATEMENT_REGISTERED',
        'SETTLEMENT_STATEMENT_ROW_RECORDED',
        'SETTLEMENT_BATCH_EXPORTED',
        'FINANCE_EVIDENCE_DOWNLOADED'
    ));
