ALTER TABLE dsh.joining_cases
    DROP CONSTRAINT joining_cases_state_chk,
    ADD CONSTRAINT joining_cases_state_chk CHECK (state IN ('draft', 'admission_requested', 'submitted', 'needs_correction', 'approved'));

ALTER TABLE dsh.joining_case_mutation_idempotency
    DROP CONSTRAINT joining_case_idempotency_operation_chk,
    ADD CONSTRAINT joining_case_idempotency_operation_chk CHECK (operation IN ('create', 'submit', 'correct', 'correct_and_resubmit', 'review', 'bind-financial-terms', 'field-admission-request')),
    DROP CONSTRAINT joining_case_idempotency_state_chk,
    ADD CONSTRAINT joining_case_idempotency_state_chk CHECK (result_state IN ('draft', 'admission_requested', 'submitted', 'needs_correction', 'approved'));

ALTER TABLE dsh.joining_case_audit
    DROP CONSTRAINT joining_case_audit_event_type_chk,
    ADD CONSTRAINT joining_case_audit_event_type_chk CHECK (event_type IN ('joining_case_created', 'joining_case_submitted', 'joining_case_corrected', 'joining_case_corrected_and_resubmitted', 'joining_case_needs_correction', 'joining_case_approved', 'joining_case_financial_terms_bound', 'joining_case_admission_requested', 'joining_case_admission_reopened'));

WITH reopened AS (
    UPDATE dsh.joining_cases AS c
    SET state='admission_requested',version=version+1,updated_at=clock_timestamp()
    WHERE c.origin='field'
      AND c.state='submitted'
      AND (
          SELECT a.event_type
          FROM dsh.joining_case_audit AS a
          WHERE a.case_id=c.id AND a.to_state='submitted'
          ORDER BY a.created_at DESC,a.id DESC
          LIMIT 1
      )='joining_case_submitted'
      AND (
          SELECT a.acting_actor_id
          FROM dsh.joining_case_audit AS a
          WHERE a.case_id=c.id AND a.to_state='submitted'
          ORDER BY a.created_at DESC,a.id DESC
          LIMIT 1
      )=c.originating_field_actor_id
    RETURNING c.id,c.partner_actor_id,c.store_id,c.version
)
INSERT INTO dsh.joining_case_audit(event_type,idempotency_key,correlation_id,acting_actor_id,case_id,from_state,to_state,result_version,request_hash,partner_actor_id,store_id)
SELECT 'joining_case_admission_reopened',
       'migration_068_field_admission_reopened_' || md5(id),
       'migration_068_field_admission_corr_' || md5(id),
       'dsh:migration:068',
       id,
       'submitted',
       'admission_requested',
       version,
       md5('field-admission-reopened:v1:' || id) || md5('field-admission-reopened:v2:' || id),
       partner_actor_id,
       store_id
FROM reopened;
