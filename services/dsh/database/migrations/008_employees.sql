CREATE TABLE __SCHEMA__.employees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_kind text NOT NULL CHECK (employer_kind IN ('COMPANY', 'MERCHANT')),
    employer_id text NOT NULL CHECK (char_length(employer_id) BETWEEN 1 AND 128),
    display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
    department text NOT NULL CHECK (char_length(btrim(department)) BETWEEN 1 AND 80),
    job_title text NOT NULL CHECK (char_length(btrim(job_title)) BETWEEN 1 AND 80),
    start_date date NOT NULL,
    end_date date CHECK (end_date >= start_date),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (employer_kind, employer_id, id)
);

CREATE TABLE __SCHEMA__.employee_registration_audit (
    employer_kind text NOT NULL,
    employer_id text NOT NULL,
    employee_id uuid NOT NULL,
    acting_actor_id text NOT NULL CHECK (char_length(acting_actor_id) BETWEEN 1 AND 128),
    operation_id uuid NOT NULL,
    request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (employer_kind, employer_id, acting_actor_id, operation_id),
    UNIQUE (employee_id),
    FOREIGN KEY (employer_kind, employer_id, employee_id)
        REFERENCES __SCHEMA__.employees(employer_kind, employer_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_employee_registration_audit_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.employee_registration_audit
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_operational_audit_rewrite();
