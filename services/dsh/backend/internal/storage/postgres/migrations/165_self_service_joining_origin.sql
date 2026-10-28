-- Prospect registration is verified through canonical Identity client sessions.
-- No Partner/Field role or Store rights are granted by the intake itself.
ALTER TABLE dsh.joining_cases
  DROP CONSTRAINT joining_cases_origin_chk,
  ADD CONSTRAINT joining_cases_origin_chk CHECK (origin IN ('field','control_panel','self_service'));

ALTER TABLE dsh.joining_cases
  ADD COLUMN applicant_actor_id text,
  ADD CONSTRAINT joining_cases_applicant_actor_chk CHECK (
    (origin='self_service' AND applicant_actor_id IS NOT NULL AND length(btrim(applicant_actor_id)) > 0)
    OR (origin <> 'self_service' AND applicant_actor_id IS NULL)
  );
CREATE UNIQUE INDEX joining_cases_applicant_actor_uq
  ON dsh.joining_cases(applicant_actor_id) WHERE applicant_actor_id IS NOT NULL;

ALTER TABLE dsh.joining_case_financial_profile_outbox
  DROP CONSTRAINT joining_case_financial_outbox_origin_chk,
  ADD CONSTRAINT joining_case_financial_outbox_origin_chk CHECK (origin IN ('field','control_panel','self_service'));
