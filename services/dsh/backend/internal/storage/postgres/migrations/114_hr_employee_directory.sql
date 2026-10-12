-- HR owns BThwani employee records; these are not Identity login roles or WLT beneficiaries.
CREATE TABLE dsh.hr_employees (
    id text PRIMARY KEY,
    full_name_ar text NOT NULL,
    phone_e164 text,
    department text NOT NULL,
    job_title text NOT NULL,
    manager_employee_id text REFERENCES dsh.hr_employees(id) ON DELETE RESTRICT,
    start_date date NOT NULL,
    work_location text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    operator_actor_id text UNIQUE,
    version integer NOT NULL DEFAULT 1,
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT hr_employee_name_chk CHECK (char_length(btrim(full_name_ar)) BETWEEN 2 AND 120),
    CONSTRAINT hr_employee_phone_chk CHECK (phone_e164 IS NULL OR phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
    CONSTRAINT hr_employee_dept_chk CHECK (char_length(btrim(department)) BETWEEN 1 AND 80),
    CONSTRAINT hr_employee_title_chk CHECK (char_length(btrim(job_title)) BETWEEN 1 AND 80),
    CONSTRAINT hr_employee_location_chk CHECK (char_length(btrim(work_location)) BETWEEN 1 AND 100),
    CONSTRAINT hr_employee_status_chk CHECK (status IN ('active','inactive')),
    CONSTRAINT hr_employee_version_chk CHECK (version > 0),
    CONSTRAINT hr_employee_actor_chk CHECK (char_length(btrim(created_by_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT hr_employee_manager_not_self_chk CHECK (manager_employee_id IS NULL OR manager_employee_id <> id)
);
CREATE UNIQUE INDEX hr_employees_phone_uq ON dsh.hr_employees(phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX hr_employees_recent_idx ON dsh.hr_employees(created_at DESC, id DESC);
CREATE INDEX hr_employees_department_idx ON dsh.hr_employees(department, status);
CREATE INDEX hr_employees_manager_idx ON dsh.hr_employees(manager_employee_id);

-- An append-only creation record doubles as a durable idempotency fence.
CREATE TABLE dsh.hr_employee_events (
    idempotency_key text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES dsh.hr_employees(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    request_hash text NOT NULL,
    acting_actor_id text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT hr_employee_event_type_chk CHECK (event_type IN ('created')),
    CONSTRAINT hr_employee_event_key_chk CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT hr_employee_event_hash_chk CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT hr_employee_event_actor_chk CHECK (char_length(btrim(acting_actor_id)) BETWEEN 1 AND 128),
    CONSTRAINT hr_employee_event_corr_chk CHECK (char_length(btrim(correlation_id)) BETWEEN 8 AND 128)
);
CREATE INDEX hr_employee_events_employee_idx ON dsh.hr_employee_events(employee_id,created_at);
