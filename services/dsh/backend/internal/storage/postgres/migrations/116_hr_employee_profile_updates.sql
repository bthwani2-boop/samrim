-- Immutable employee change history for HR corrections, including before/after values.
ALTER TABLE dsh.hr_employee_events
  DROP CONSTRAINT hr_employee_event_type_chk,
  ADD CONSTRAINT hr_employee_event_type_chk CHECK (event_type IN ('created','updated'));
ALTER TABLE dsh.hr_employee_events
  ADD COLUMN before_snapshot jsonb,
  ADD COLUMN after_snapshot jsonb;
ALTER TABLE dsh.hr_employee_events
  ADD CONSTRAINT hr_employee_update_snapshots_chk CHECK (
    event_type <> 'updated' OR (before_snapshot IS NOT NULL AND after_snapshot IS NOT NULL)
  );
CREATE INDEX hr_employee_events_recent_idx ON dsh.hr_employee_events(employee_id, created_at DESC);

-- Identity approval acts on the verified request snapshot, never silently on
-- mutable employee fields changed after HR submitted the request.
ALTER TABLE dsh.hr_operator_access_requests
  ADD COLUMN employee_name_snapshot text,
  ADD COLUMN phone_e164_snapshot text,
  ADD COLUMN department_snapshot text,
  ADD COLUMN job_title_snapshot text;
UPDATE dsh.hr_operator_access_requests r SET
 employee_name_snapshot=e.full_name_ar,
 phone_e164_snapshot=e.phone_e164,
 department_snapshot=e.department,
 job_title_snapshot=e.job_title
FROM dsh.hr_employees e WHERE e.id=r.employee_id;
ALTER TABLE dsh.hr_operator_access_requests
  ALTER COLUMN employee_name_snapshot SET NOT NULL,
  ALTER COLUMN phone_e164_snapshot SET NOT NULL,
  ALTER COLUMN department_snapshot SET NOT NULL,
  ALTER COLUMN job_title_snapshot SET NOT NULL,
  ADD CONSTRAINT hr_access_snapshot_chk CHECK (
    char_length(btrim(employee_name_snapshot)) BETWEEN 2 AND 120
    AND phone_e164_snapshot ~ '^[+][1-9][0-9]{7,14}$'
    AND char_length(btrim(department_snapshot)) BETWEEN 1 AND 80
    AND char_length(btrim(job_title_snapshot)) BETWEEN 1 AND 80
  );
