-- Preserve the employee record and decision history when employment status changes.
ALTER TABLE dsh.hr_employee_events DROP CONSTRAINT hr_employee_event_type_chk;
ALTER TABLE dsh.hr_employee_events
  ADD CONSTRAINT hr_employee_event_type_chk CHECK (event_type IN ('created','updated','status_changed'));
ALTER TABLE dsh.hr_employee_events
  DROP CONSTRAINT hr_employee_update_snapshots_chk;
ALTER TABLE dsh.hr_employee_events
  ADD CONSTRAINT hr_employee_update_snapshots_chk CHECK (
    event_type NOT IN ('updated','status_changed') OR (before_snapshot IS NOT NULL AND after_snapshot IS NOT NULL)
  );
ALTER TABLE dsh.hr_employee_events ADD COLUMN reason text;
ALTER TABLE dsh.hr_employee_events
  ADD CONSTRAINT hr_employee_status_reason_chk CHECK (
    event_type <> 'status_changed' OR char_length(btrim(reason)) BETWEEN 8 AND 500
  );
