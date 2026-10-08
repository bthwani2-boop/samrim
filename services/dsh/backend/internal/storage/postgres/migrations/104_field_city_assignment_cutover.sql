-- Migration 103 backfilled the legacy scalar city into the canonical
-- assignment relation. New assignments are multi-city or dynamically all-active.
DROP INDEX IF EXISTS dsh.field_admissions_service_city_idx;

ALTER TABLE dsh.field_admissions
    DROP CONSTRAINT field_admissions_pending_service_city_chk,
    DROP CONSTRAINT field_admissions_service_city_fk,
    DROP COLUMN service_city_id;
