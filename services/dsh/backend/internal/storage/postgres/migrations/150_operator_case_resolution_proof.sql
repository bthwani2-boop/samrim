-- Do not close money/custody incidents without a verified owner event.
ALTER TABLE dsh.operator_order_cases
 ADD COLUMN resolution_evidence_ref text,
 ADD CONSTRAINT ops_case_sensitive_evidence_chk CHECK (
   state<>'RESOLVED' OR reason NOT IN ('PAYMENT_EXCEPTION','DELIVERY_BLOCKED')
   OR (resolution_evidence_ref IS NOT NULL AND
       char_length(btrim(resolution_evidence_ref)) BETWEEN 8 AND 128)
 ) NOT VALID;
