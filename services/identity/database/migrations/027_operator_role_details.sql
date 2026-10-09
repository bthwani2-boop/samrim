ALTER TABLE identity_actor_roles
    ADD COLUMN job_title text NOT NULL DEFAULT '',
    ADD COLUMN department text NOT NULL DEFAULT '';

ALTER TABLE identity_actor_roles
    ADD CONSTRAINT identity_actor_role_operator_details_chk CHECK (
        (role = 'operator' OR (job_title = '' AND department = ''))
        AND job_title = btrim(job_title)
        AND department = btrim(department)
        AND char_length(job_title) <= 80
        AND char_length(department) <= 80
    ) NOT VALID;

ALTER TABLE identity_operator_profiles
    ADD COLUMN job_title text NOT NULL DEFAULT '',
    ADD COLUMN department text NOT NULL DEFAULT '';

ALTER TABLE identity_operator_profiles
    ADD CONSTRAINT identity_operator_profiles_details_chk CHECK (
        (state = 'admitted' OR (job_title <> '' AND department <> ''))
        AND job_title = btrim(job_title)
        AND department = btrim(department)
        AND char_length(job_title) <= 80
        AND char_length(department) <= 80
    ) NOT VALID;

ALTER TABLE identity_operator_profile_events
    DROP CONSTRAINT identity_operator_profile_events_type_chk;

ALTER TABLE identity_operator_profile_events
    ADD CONSTRAINT identity_operator_profile_events_type_chk
    CHECK (event_type IN ('created', 'profile_updated', 'details_updated', 'approved', 'role_admitted'));
