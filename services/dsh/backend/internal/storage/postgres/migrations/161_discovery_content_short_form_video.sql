-- Existing discovery content IDs, rights, publication, and target relations remain unchanged.
ALTER TABLE dsh.discovery_content_media_assets
 DROP CONSTRAINT discovery_content_media_type_chk,
 ADD CONSTRAINT discovery_content_media_type_chk
 CHECK (content_type IN ('image/jpeg', 'image/png', 'video/mp4'));
