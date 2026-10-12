-- Explicit manually entered HR attendance; no implied absence or payroll result.
CREATE TABLE dsh.hr_attendance_records (
  employee_id text NOT NULL REFERENCES dsh.hr_employees(id) ON DELETE RESTRICT,
  attendance_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent','late','leave')),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 8 AND 500),
  check_in_at timestamptz,
  check_out_at timestamptz,
  version integer NOT NULL CHECK (version > 0),
  recorded_by_actor_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (employee_id, attendance_date),
  CONSTRAINT hr_attendance_record_time_chk CHECK (
    (check_in_at IS NULL AND check_out_at IS NULL) OR
    (status IN ('present','late') AND check_in_at IS NOT NULL AND check_out_at IS NOT NULL
     AND check_out_at > check_in_at AND check_out_at <= check_in_at + interval '36 hours')
  )
);
CREATE INDEX hr_attendance_records_date_idx ON dsh.hr_attendance_records(attendance_date DESC, employee_id);

-- Immutable event evidence for every initial record and correction.
CREATE TABLE dsh.hr_attendance_events (
  idempotency_key text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES dsh.hr_employees(id) ON DELETE RESTRICT,
  attendance_date date NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  acting_actor_id text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent','late','leave')),
  note text NOT NULL,
  check_in_at timestamptz,
  check_out_at timestamptz,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hr_attendance_event_version_uq UNIQUE (employee_id,attendance_date,version)
);
CREATE INDEX hr_attendance_events_history_idx ON dsh.hr_attendance_events(employee_id,attendance_date,version DESC);
