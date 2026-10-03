-- A transfer receipt proves one financial transfer. Claim it once across all
-- WLT transfer paths so the same stored evidence cannot close separate debts.
CREATE TABLE wlt.finance_transfer_receipt_claims (
    evidence_document_id text PRIMARY KEY REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT,
    transfer_type text NOT NULL,
    transfer_id text NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT finance_transfer_receipt_claims_type_chk CHECK (transfer_type IN ('CAPTAIN_CASH_REMITTANCE','PARTNER_COMMISSION_REMITTANCE','BENEFICIARY_PAYOUT_TRANSFER')),
    CONSTRAINT finance_transfer_receipt_claims_transfer_chk CHECK (length(btrim(transfer_id)) BETWEEN 1 AND 128),
    CONSTRAINT finance_transfer_receipt_claims_transfer_uq UNIQUE (transfer_type,transfer_id)
);

DO $$
DECLARE duplicate_document_id text;
BEGIN
    WITH existing_transfer_receipts AS (
        SELECT receipt_document_id AS evidence_document_id
        FROM wlt.cash_remittances
        WHERE state='REMITTED' AND receipt_document_id IS NOT NULL
        UNION ALL
        SELECT receipt_document_id
        FROM wlt.partner_commission_remittances
        WHERE receipt_document_id IS NOT NULL
        UNION ALL
        SELECT receipt_document_id
        FROM wlt.manual_transfer_executions
        WHERE receipt_document_id IS NOT NULL
    )
    SELECT evidence_document_id INTO duplicate_document_id
    FROM existing_transfer_receipts
    GROUP BY evidence_document_id
    HAVING COUNT(*) > 1
    LIMIT 1;

    IF duplicate_document_id IS NOT NULL THEN
        RAISE EXCEPTION 'WLT transfer receipt % is already linked to multiple transfers', duplicate_document_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM wlt.cash_remittances r
        JOIN wlt.finance_evidence_documents d ON d.id=r.receipt_document_id
        WHERE r.state='REMITTED' AND r.receipt_document_id IS NOT NULL AND d.purpose<>'TRANSFER_RECEIPT'
        UNION ALL
        SELECT 1 FROM wlt.partner_commission_remittances r
        JOIN wlt.finance_evidence_documents d ON d.id=r.receipt_document_id
        WHERE r.receipt_document_id IS NOT NULL AND d.purpose<>'TRANSFER_RECEIPT'
        UNION ALL
        SELECT 1 FROM wlt.manual_transfer_executions r
        JOIN wlt.finance_evidence_documents d ON d.id=r.receipt_document_id
        WHERE r.receipt_document_id IS NOT NULL AND d.purpose<>'TRANSFER_RECEIPT'
    ) THEN
        RAISE EXCEPTION 'WLT transfer records contain evidence that is not a transfer receipt';
    END IF;
END $$;

INSERT INTO wlt.finance_transfer_receipt_claims(evidence_document_id,transfer_type,transfer_id)
SELECT receipt_document_id,'CAPTAIN_CASH_REMITTANCE',id
FROM wlt.cash_remittances
WHERE state='REMITTED' AND receipt_document_id IS NOT NULL
UNION ALL
SELECT receipt_document_id,'PARTNER_COMMISSION_REMITTANCE',id
FROM wlt.partner_commission_remittances
WHERE receipt_document_id IS NOT NULL
UNION ALL
SELECT receipt_document_id,'BENEFICIARY_PAYOUT_TRANSFER',id
FROM wlt.manual_transfer_executions
WHERE receipt_document_id IS NOT NULL;
