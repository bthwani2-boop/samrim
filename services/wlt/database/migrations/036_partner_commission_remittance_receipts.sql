-- Keep historical text-only remittance evidence readable while requiring new
-- records to reference a stored, Finance-uploaded transfer receipt.
ALTER TABLE wlt.partner_commission_remittances
    ADD COLUMN receipt_document_id text;

ALTER TABLE wlt.partner_commission_remittances
    ALTER COLUMN evidence_reference DROP NOT NULL,
    DROP CONSTRAINT partner_commission_remittances_reference_chk,
    ADD CONSTRAINT partner_commission_remittances_reference_chk CHECK (
        length(btrim(remittance_reference)) BETWEEN 1 AND 128
        AND (
            (receipt_document_id IS NOT NULL AND (evidence_reference IS NULL OR length(btrim(evidence_reference)) BETWEEN 1 AND 512))
            OR (receipt_document_id IS NULL AND evidence_reference IS NOT NULL AND length(btrim(evidence_reference)) BETWEEN 1 AND 512)
        )
    ),
    ADD CONSTRAINT partner_commission_remittances_receipt_document_fk
        FOREIGN KEY (receipt_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX partner_commission_remittances_receipt_document_uq
    ON wlt.partner_commission_remittances(receipt_document_id)
    WHERE receipt_document_id IS NOT NULL;
