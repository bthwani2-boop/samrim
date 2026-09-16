ALTER TABLE dsh.captain_admissions
    DROP CONSTRAINT captain_admissions_phone_chk;

ALTER TABLE dsh.captain_admissions
    ADD CONSTRAINT captain_admissions_phone_chk
    CHECK (contact_phone_e164 IS NULL OR contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
