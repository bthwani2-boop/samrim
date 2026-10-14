ALTER TABLE dsh.store_profile_media_assets
  DROP CONSTRAINT store_profile_media_role_chk,
  ADD CONSTRAINT store_profile_media_role_chk CHECK (media_role IN ('primary', 'cover'));

DROP INDEX dsh.store_profile_media_case_active_uq;
CREATE UNIQUE INDEX store_profile_media_case_role_active_uq
  ON dsh.store_profile_media_assets(joining_case_id, media_role)
  WHERE state = 'active';

DROP INDEX dsh.store_profile_media_store_active_uq;
CREATE UNIQUE INDEX store_profile_media_store_role_active_uq
  ON dsh.store_profile_media_assets(store_id, media_role)
  WHERE state = 'active' AND store_id IS NOT NULL;

ALTER TABLE dsh.store_profile_media_audit
  DROP CONSTRAINT store_profile_media_audit_event_chk,
  ADD CONSTRAINT store_profile_media_audit_event_chk CHECK (event_type IN (
    'store_profile_image_attached', 'store_profile_image_replaced',
    'store_cover_image_attached', 'store_cover_image_replaced'
  ));
