ALTER TABLE dsh.joining_cases
    ADD COLUMN terms_policy_version text,
    ADD CONSTRAINT joining_cases_terms_policy_version_chk CHECK (terms_policy_version IS NULL OR terms_policy_version LIKE 'partner-financial-terms:v%');

ALTER TABLE dsh.joining_case_financial_profile_outbox
    ADD COLUMN terms_policy_version text,
    ADD CONSTRAINT joining_case_financial_outbox_policy_version_chk CHECK (terms_policy_version IS NULL OR terms_policy_version LIKE 'partner-financial-terms:v%');

ALTER TABLE dsh.joining_case_audit
    DROP CONSTRAINT joining_case_audit_event_type_chk,
    ADD CONSTRAINT joining_case_audit_event_type_chk CHECK (event_type IN ('joining_case_created', 'joining_case_submitted', 'joining_case_corrected', 'joining_case_corrected_and_resubmitted', 'joining_case_needs_correction', 'joining_case_approved', 'joining_case_financial_terms_bound'));

ALTER TABLE dsh.joining_case_mutation_idempotency
    DROP CONSTRAINT joining_case_idempotency_operation_chk,
    ADD CONSTRAINT joining_case_idempotency_operation_chk CHECK (operation IN ('create', 'submit', 'correct', 'correct_and_resubmit', 'review', 'bind-financial-terms'));
