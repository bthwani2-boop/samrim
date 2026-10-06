-- Partner joining has two authorized entry surfaces: Field and the Control
-- partner workspace. Keep one canonical case writer while making provenance
-- explicit so follow-up ownership is deterministic.
ALTER TABLE dsh.joining_cases
    ADD COLUMN origin text;

UPDATE dsh.joining_cases
SET origin = CASE WHEN originating_field_actor_id IS NULL THEN 'control_panel' ELSE 'field' END
WHERE origin IS NULL;

ALTER TABLE dsh.joining_cases
    ALTER COLUMN origin SET NOT NULL,
    DROP CONSTRAINT joining_cases_field_actor_chk,
    ADD CONSTRAINT joining_cases_origin_chk CHECK (origin IN ('field', 'control_panel')),
    ADD CONSTRAINT joining_cases_field_actor_chk CHECK (origin = 'control_panel' OR length(btrim(originating_field_actor_id)) > 0);
