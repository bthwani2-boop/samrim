-- Internal optional premises photo: case-scoped and removed on approval.
CREATE TABLE dsh.joining_case_review_photos (
 joining_case_id text PRIMARY KEY REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT,
 image_bytes bytea NOT NULL,
 content_type text NOT NULL,
 content_sha256 text NOT NULL,
 uploaded_by_field_actor_id text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT joining_case_review_photos_size_chk CHECK (octet_length(image_bytes) BETWEEN 1 AND 10485760),
 CONSTRAINT joining_case_review_photos_content_chk CHECK (content_type IN ('image/jpeg','image/png')),
 CONSTRAINT joining_case_review_photos_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);
ALTER TABLE dsh.joining_case_mutation_idempotency
 DROP CONSTRAINT joining_case_idempotency_operation_chk,
 ADD CONSTRAINT joining_case_idempotency_operation_chk
 CHECK (operation IN ('create','submit','correct','correct_and_resubmit','review','bind-financial-terms','field-admission-request','draft_update','review-photo-upload'));
