ALTER TABLE dsh.field_admissions
    ADD COLUMN service_city_id text,
    ADD CONSTRAINT field_admissions_service_city_fk
        FOREIGN KEY (service_city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT,
    ADD CONSTRAINT field_admissions_pending_service_city_chk
        CHECK (state NOT IN ('pending_review', 'pending_identity') OR service_city_id IS NOT NULL);

CREATE INDEX field_admissions_service_city_idx
    ON dsh.field_admissions(service_city_id, state, updated_at DESC, id)
    WHERE service_city_id IS NOT NULL;
