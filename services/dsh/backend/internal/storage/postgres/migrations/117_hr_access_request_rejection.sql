-- Preserve rejected requests but permit one live access cycle per employee.
ALTER TABLE dsh.hr_operator_access_requests
  DROP CONSTRAINT hr_operator_access_requests_employee_id_key,
  DROP CONSTRAINT hr_access_state_chk,
  DROP CONSTRAINT hr_access_transition_chk;
ALTER TABLE dsh.hr_operator_access_requests
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN rejected_by_actor_id text,
  ADD COLUMN rejection_reason text,
  ADD COLUMN provisioning_at timestamptz,
  ADD COLUMN provisioning_by_actor_id text;
-- Existing linked requests never passed through a provisioning claim in v115.
UPDATE dsh.hr_operator_access_requests
 SET provisioning_at=updated_at,provisioning_by_actor_id=linked_by_actor_id
 WHERE state='identity_profile_created';
ALTER TABLE dsh.hr_operator_access_requests
  ADD CONSTRAINT hr_access_state_chk CHECK (state IN ('pending_review','identity_provisioning','identity_profile_created','rejected')),
  ADD CONSTRAINT hr_access_transition_chk CHECK (
    (state='pending_review' AND operator_profile_id IS NULL AND linked_by_actor_id IS NULL
      AND rejected_at IS NULL AND rejected_by_actor_id IS NULL AND rejection_reason IS NULL
      AND provisioning_at IS NULL AND provisioning_by_actor_id IS NULL)
    OR (state='identity_provisioning' AND operator_profile_id IS NULL AND linked_by_actor_id IS NULL
      AND rejected_at IS NULL AND rejected_by_actor_id IS NULL AND rejection_reason IS NULL
      AND provisioning_at IS NOT NULL AND provisioning_by_actor_id IS NOT NULL)
    OR (state='identity_profile_created' AND operator_profile_id IS NOT NULL AND linked_by_actor_id IS NOT NULL
      AND rejected_at IS NULL AND rejected_by_actor_id IS NULL AND rejection_reason IS NULL
      AND provisioning_at IS NOT NULL AND provisioning_by_actor_id IS NOT NULL)
    OR (state='rejected' AND operator_profile_id IS NULL AND linked_by_actor_id IS NULL
      AND rejected_at IS NOT NULL AND rejected_by_actor_id IS NOT NULL
      AND char_length(btrim(rejection_reason)) BETWEEN 8 AND 500
      AND provisioning_at IS NULL AND provisioning_by_actor_id IS NULL)
  );
CREATE UNIQUE INDEX hr_access_live_employee_uq
  ON dsh.hr_operator_access_requests(employee_id) WHERE state <> 'rejected';
ALTER TABLE dsh.hr_operator_access_events
  DROP CONSTRAINT hr_operator_access_events_event_type_check;
ALTER TABLE dsh.hr_operator_access_events
  ADD CONSTRAINT hr_operator_access_events_event_type_check
  CHECK (event_type IN ('requested','identity_provisioning','identity_profile_created','rejected'));
CREATE INDEX hr_access_employee_history_idx
  ON dsh.hr_operator_access_requests(employee_id,created_at DESC,id DESC);
