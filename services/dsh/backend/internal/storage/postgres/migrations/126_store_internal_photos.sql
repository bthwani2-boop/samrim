CREATE TABLE dsh.store_internal_photos (
    id text PRIMARY KEY,
    joining_case_id text NOT NULL REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT,
    store_id text REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    content_type text NOT NULL,
    content_sha256 text NOT NULL,
    image_bytes bytea NOT NULL,
    uploaded_by_field_actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT store_internal_photos_size_chk CHECK (octet_length(image_bytes) BETWEEN 1 AND 10485760),
    CONSTRAINT store_internal_photos_content_chk CHECK (content_type IN ('image/jpeg','image/png')),
    CONSTRAINT store_internal_photos_sha_chk CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT store_internal_photos_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX store_internal_photos_store_idx ON dsh.store_internal_photos(store_id, created_at DESC) WHERE store_id IS NOT NULL;
CREATE INDEX store_internal_photos_case_idx ON dsh.store_internal_photos(joining_case_id, created_at DESC);
