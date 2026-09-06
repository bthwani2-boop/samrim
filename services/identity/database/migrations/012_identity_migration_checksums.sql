ALTER TABLE identity_schema_migrations
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS sha256 text;

UPDATE identity_schema_migrations SET name='001_identity_authentication.sql', sha256='ee8bf279605c717924185c50e1c48ef2ebb1329a570eacd771370837a75b1c4d' WHERE version=1;
UPDATE identity_schema_migrations SET name='002_identity_challenge_delivery.sql', sha256='33128acb057bf08ff6b0adfd283f5dd4f57e05af34218805da439eea24f77d6b' WHERE version=2;
UPDATE identity_schema_migrations SET name='003_managed_activation_codes.sql', sha256='f969a6e3d2b996de798802290ad07899d69ea9287f472f4ce829a4a4737b820b' WHERE version=3;
UPDATE identity_schema_migrations SET name='004_control_panel_roles.sql', sha256='9201cde4db523fc77fb42fdb0ddc896670689e945ea07cf7b34410b2bc39a1f9' WHERE version=4;
UPDATE identity_schema_migrations SET name='005_platform_owner_activation.sql', sha256='5b51535db2812c5eade14e07272db9e79eb59a4292326754532b805782e731b2' WHERE version=5;
UPDATE identity_schema_migrations SET name='006_managed_role_passwords.sql', sha256='42fb4c1844c907f26ed081bb9a242047e96dab10332fb85dfeb6b8da437a43bd' WHERE version=6;
UPDATE identity_schema_migrations SET name='007_four_digit_challenges.sql', sha256='4656b506dfb765124cb6ddec7d91abf9018b9b8117e547f5cc8fd7b1e70e9641' WHERE version=7;
UPDATE identity_schema_migrations SET name='008_identity_session_lifetimes.sql', sha256='e1156050faa924c0529ba8d1f873cbc991101d937f029d1d1f24f2a78bf8acbf' WHERE version=8;
UPDATE identity_schema_migrations SET name='009_control_session_lifetimes.sql', sha256='f8d4c2980539559ee6eef388a5a766a288416a702edbfdd99625a3fb01f878cd' WHERE version=9;
UPDATE identity_schema_migrations SET name='010_identity_proof_fences.sql', sha256='f1ba88d1c00ecaadcfcdc3d797cddbd87fee87c4eed158adda2ae6a626e9733e' WHERE version=10;
UPDATE identity_schema_migrations SET name='011_identity_recovery_purpose.sql', sha256='cdd0105149f017da0fc7582ea346615d9f9ad7f35d7de634af691d415007dd73' WHERE version=11;

INSERT INTO identity_schema_migrations(version, name, sha256)
VALUES (12, '', '')
ON CONFLICT (version) DO NOTHING;
