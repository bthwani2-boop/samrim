-- Keep the owning Store independent from the content destination.
-- Shared central catalog products may appear in many Stores.
ALTER TABLE dsh.discovery_content
  ADD COLUMN source_store_id text REFERENCES dsh.stores(id) ON DELETE RESTRICT;
ALTER TABLE dsh.discovery_content
  ADD CONSTRAINT discovery_content_partner_source_chk CHECK (
    source_store_id IS NULL OR
    (kind = 'SHORT_FORM' AND target_type IN ('STORE','PRODUCT','PROMOTION'))
  );
CREATE INDEX discovery_content_partner_source_idx
  ON dsh.discovery_content(source_store_id, created_at DESC)
  WHERE source_store_id IS NOT NULL;
