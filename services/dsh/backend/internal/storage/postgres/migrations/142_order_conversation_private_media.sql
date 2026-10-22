-- Private Order message media lives in the same guarded message row: no public object URL.
ALTER TABLE dsh.commerce_order_conversation_messages
    ADD COLUMN media_kind text,
    ADD COLUMN media_content_type text,
    ADD COLUMN media_data bytea;
ALTER TABLE dsh.commerce_order_conversation_messages
    ADD CONSTRAINT commerce_order_conversation_media_chk CHECK (
      (media_kind IS NULL AND media_content_type IS NULL AND media_data IS NULL)
      OR
      (media_kind = 'image' AND media_content_type IN ('image/jpeg','image/png','image/webp')
       AND octet_length(media_data) BETWEEN 1 AND 3145728)
      OR
      (media_kind = 'audio' AND media_content_type IN ('audio/mp4','audio/m4a','audio/aac','audio/3gpp','audio/webm')
       AND octet_length(media_data) BETWEEN 1 AND 1572864)
    );
