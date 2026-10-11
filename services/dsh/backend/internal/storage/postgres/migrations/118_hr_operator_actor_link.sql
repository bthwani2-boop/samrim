-- Identity grants an operator role; HR keeps the durable employee-to-actor link.
-- Keep rejected and legacy requests, and preserve all previously issued credentials.
ALTER TABLE dsh.hr_operator_access_events
  DROP CONSTRAINT hr_operator_access_events_event_type_check;
ALTER TABLE dsh.hr_operator_access_events
  ADD CONSTRAINT hr_operator_access_events_event_type_check
  CHECK (event_type IN ('requested','identity_provisioning','identity_profile_created','rejected','operator_admitted'));
CREATE INDEX hr_access_profile_lookup_idx
  ON dsh.hr_operator_access_requests(operator_profile_id)
  WHERE operator_profile_id IS NOT NULL;
