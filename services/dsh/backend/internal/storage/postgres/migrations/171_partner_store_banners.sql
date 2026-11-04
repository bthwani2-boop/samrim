-- Store-authored image banners share the canonical discovery-content owner and
-- review/publication workflow. The Partner may hide/show only its own approved banners.
ALTER TABLE dsh.discovery_content
  DROP CONSTRAINT discovery_content_partner_source_chk,
  ADD CONSTRAINT discovery_content_partner_source_chk CHECK (
    source_store_id IS NULL OR
    (kind IN ('SHORT_FORM','BANNER') AND target_type IN ('STORE','PRODUCT','PROMOTION'))
  ),
  ADD COLUMN partner_enabled boolean NOT NULL DEFAULT true;
