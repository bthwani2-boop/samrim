-- Add passport without reclassifying existing freelance-work evidence as passport.
ALTER TABLE dsh.joining_cases
    DROP CONSTRAINT joining_cases_first_store_proof_type_chk;
ALTER TABLE dsh.joining_cases
    ADD CONSTRAINT joining_cases_first_store_proof_type_chk
        CHECK (first_store_proof_type IS NULL OR first_store_proof_type IN
            ('COMMERCIAL_REGISTRATION', 'IDENTITY_DOCUMENT', 'PASSPORT', 'FREELANCE_WORK_DOCUMENT'));
