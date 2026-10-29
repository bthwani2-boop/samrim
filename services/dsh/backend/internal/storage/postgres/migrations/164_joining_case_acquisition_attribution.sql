-- Attribute a verified Field referral to an Operator-origin joining case without
-- changing its origin or granting Field access to Operator-owned case data.
-- Only extends the canonical audit/idempotency enumerations. No existing row updates.
ALTER TABLE dsh.joining_case_mutation_idempotency
  DROP CONSTRAINT joining_case_idempotency_operation_chk,
  ADD CONSTRAINT joining_case_idempotency_operation_chk CHECK (
    operation IN (
      'create', 'submit', 'correct', 'correct_and_resubmit', 'review',
      'bind-financial-terms', 'field-admission-request', 'draft_update',
      'acquisition_attribution'
    )
  );

ALTER TABLE dsh.joining_case_audit
  DROP CONSTRAINT joining_case_audit_event_type_chk,
  ADD CONSTRAINT joining_case_audit_event_type_chk CHECK (
    event_type IN (
      'joining_case_created', 'joining_case_submitted', 'joining_case_corrected',
      'joining_case_corrected_and_resubmitted', 'joining_case_needs_correction',
      'joining_case_approved', 'joining_case_financial_terms_bound',
      'joining_case_admission_requested', 'joining_case_admission_reopened',
      'joining_case_draft_updated', 'joining_case_acquisition_attributed'
    )
  );
