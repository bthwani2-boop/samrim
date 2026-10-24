ALTER TABLE dsh.wallet_providers ADD COLUMN logo_uri text NOT NULL DEFAULT '';
CREATE TABLE dsh.wallet_provider_logo_uploads (
 idempotency_key text PRIMARY KEY,
 provider_key text NOT NULL REFERENCES dsh.wallet_providers(key),
 expected_version int NOT NULL CHECK(expected_version>0),
 request_hash text NOT NULL,
 object_key text NOT NULL UNIQUE,
 logo_uri text NOT NULL,
 content_sha256 text NOT NULL CHECK(length(content_sha256)=64),
 content_type text NOT NULL CHECK(content_type IN ('image/png','image/jpeg')),
 acting_actor_id text NOT NULL,
 correlation_id text NOT NULL,
 creator text NOT NULL,
 source_description text NOT NULL,
 source_uri text NOT NULL,
 rights_statement text NOT NULL,
 rights_uri text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
