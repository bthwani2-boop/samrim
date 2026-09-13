ALTER TABLE dsh.joining_case_mutation_idempotency
    DROP CONSTRAINT joining_case_idempotency_operation_chk,
    ADD CONSTRAINT joining_case_idempotency_operation_chk CHECK (operation IN ('create', 'submit', 'correct', 'review'));

ALTER TABLE dsh.joining_case_audit
    DROP CONSTRAINT joining_case_audit_event_type_chk,
    ADD CONSTRAINT joining_case_audit_event_type_chk CHECK (event_type IN ('joining_case_created', 'joining_case_submitted', 'joining_case_corrected', 'joining_case_needs_correction', 'joining_case_approved'));
