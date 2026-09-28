ALTER TABLE dsh.catalog_media_assets
    ADD CONSTRAINT catalog_media_assets_product_id_uq UNIQUE (product_id, id);

ALTER TABLE dsh.catalog_media
    ADD COLUMN media_asset_id text;

UPDATE dsh.catalog_media media
SET media_asset_id = asset.id
FROM dsh.catalog_media_assets asset
WHERE asset.product_id = media.product_id
  AND asset.uri = media.uri
  AND asset.state = 'active';

DELETE FROM dsh.catalog_media
WHERE media_asset_id IS NULL;

DELETE FROM dsh.catalog_media duplicate
USING dsh.catalog_media canonical
WHERE duplicate.product_id = canonical.product_id
  AND duplicate.media_asset_id = canonical.media_asset_id
  AND (duplicate.ordinal, duplicate.id) > (canonical.ordinal, canonical.id);

UPDATE dsh.catalog_media_assets asset
SET state = 'retired', retired_at = COALESCE(asset.retired_at, clock_timestamp()), last_cleanup_error = NULL
WHERE asset.state = 'active'
  AND NOT EXISTS (
      SELECT 1
      FROM dsh.catalog_media media
      WHERE media.product_id = asset.product_id
        AND media.media_asset_id = asset.id
  );

ALTER TABLE dsh.catalog_media
    DROP CONSTRAINT catalog_media_uri_chk,
    DROP COLUMN uri,
    ALTER COLUMN media_asset_id SET NOT NULL,
    ADD CONSTRAINT catalog_media_product_asset_fk
        FOREIGN KEY (product_id, media_asset_id)
        REFERENCES dsh.catalog_media_assets(product_id, id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT catalog_media_product_asset_uq UNIQUE (product_id, media_asset_id);

ALTER TABLE dsh.catalog_product_proposals
    DROP COLUMN proposed_image_uri;
