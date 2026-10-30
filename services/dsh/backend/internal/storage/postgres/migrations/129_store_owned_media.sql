-- Store media continues in the same asset and cleanup owner after onboarding.
ALTER TABLE dsh.store_profile_media_assets ALTER COLUMN joining_case_id DROP NOT NULL;
ALTER TABLE dsh.store_profile_media_assets ADD CONSTRAINT store_profile_media_target_chk CHECK (joining_case_id IS NOT NULL OR store_id IS NOT NULL);
ALTER TABLE dsh.store_profile_media_audit ALTER COLUMN joining_case_id DROP NOT NULL;
ALTER TABLE dsh.store_profile_media_audit ADD COLUMN store_id text REFERENCES dsh.stores(id) ON DELETE RESTRICT;
ALTER TABLE dsh.store_profile_media_audit ADD CONSTRAINT store_profile_media_audit_target_chk CHECK (joining_case_id IS NOT NULL OR store_id IS NOT NULL);
CREATE INDEX store_profile_media_audit_store_idx ON dsh.store_profile_media_audit(store_id,created_at DESC);
