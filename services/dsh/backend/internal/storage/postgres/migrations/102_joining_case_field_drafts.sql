-- Field may save incomplete onboarding data while the case remains a draft.
-- The service validates the complete intake and active references before the
-- transition to admission_requested.
ALTER TABLE dsh.joining_cases
    DROP CONSTRAINT joining_cases_business_name_chk,
    DROP CONSTRAINT joining_cases_store_name_chk,
    ADD CONSTRAINT joining_cases_business_name_chk
        CHECK (state = 'draft' OR char_length(btrim(business_name)) BETWEEN 2 AND 160),
    ADD CONSTRAINT joining_cases_store_name_chk
        CHECK (state = 'draft' OR char_length(btrim(first_store_name)) BETWEEN 2 AND 160);

ALTER TABLE dsh.joining_case_private_evidence
    ALTER COLUMN proof_number_key_id DROP NOT NULL,
    ALTER COLUMN proof_number_ciphertext DROP NOT NULL,
    DROP CONSTRAINT joining_case_private_evidence_key_id_chk,
    ADD CONSTRAINT joining_case_private_evidence_key_id_chk
        CHECK (proof_number_key_id IS NULL OR proof_number_key_id ~ '^[a-zA-Z0-9_-]{1,32}$'),
    ADD CONSTRAINT joining_case_private_evidence_number_pair_chk
        CHECK ((proof_number_key_id IS NULL AND proof_number_ciphertext IS NULL)
            OR (proof_number_key_id IS NOT NULL AND proof_number_ciphertext IS NOT NULL));

ALTER TABLE dsh.joining_case_mutation_idempotency
    DROP CONSTRAINT joining_case_idempotency_operation_chk,
    ADD CONSTRAINT joining_case_idempotency_operation_chk
        CHECK (operation IN ('create', 'submit', 'correct', 'correct_and_resubmit', 'review', 'bind-financial-terms', 'field-admission-request', 'draft_update'));

ALTER TABLE dsh.joining_case_audit
    DROP CONSTRAINT joining_case_audit_event_type_chk,
    ADD CONSTRAINT joining_case_audit_event_type_chk
        CHECK (event_type IN ('joining_case_created', 'joining_case_submitted', 'joining_case_corrected', 'joining_case_corrected_and_resubmitted', 'joining_case_needs_correction', 'joining_case_approved', 'joining_case_financial_terms_bound', 'joining_case_admission_requested', 'joining_case_admission_reopened', 'joining_case_draft_updated'));

CREATE OR REPLACE FUNCTION dsh.require_new_commercial_store_type() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.state <> 'draft' AND NEW.first_store_commercial_type_id IS NULL THEN
        RAISE EXCEPTION 'first store commercial type is required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
