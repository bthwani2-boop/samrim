-- Field city scope is an operator-facing assignment. It does not authorize
-- Field-originated joining cases, which continue to select their own city.
ALTER TABLE dsh.field_admissions
    ADD COLUMN all_service_cities boolean NOT NULL DEFAULT false;

CREATE TABLE dsh.field_admission_service_cities (
    admission_id text NOT NULL,
    service_city_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT field_admission_service_cities_pkey PRIMARY KEY (admission_id, service_city_id),
    CONSTRAINT field_admission_service_cities_admission_fk FOREIGN KEY (admission_id) REFERENCES dsh.field_admissions(id) ON DELETE RESTRICT,
    CONSTRAINT field_admission_service_cities_city_fk FOREIGN KEY (service_city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT
);
CREATE INDEX field_admission_service_cities_city_idx ON dsh.field_admission_service_cities(service_city_id, admission_id);

INSERT INTO dsh.field_admission_service_cities(admission_id, service_city_id)
SELECT id, service_city_id FROM dsh.field_admissions WHERE service_city_id IS NOT NULL
ON CONFLICT DO NOTHING;
