ALTER TABLE dsh.captain_admission_audit
    ADD COLUMN reason text;

ALTER TABLE dsh.captain_admission_audit
    ADD CONSTRAINT captain_admission_audit_reason_chk
    CHECK (reason IS NULL OR (char_length(btrim(reason)) BETWEEN 5 AND 500));
