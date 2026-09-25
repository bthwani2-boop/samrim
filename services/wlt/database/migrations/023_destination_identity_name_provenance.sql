ALTER TABLE wlt.official_wallet_destinations
    ADD COLUMN beneficiary_identity_version integer,
    ADD CONSTRAINT official_wallet_destinations_identity_version_chk CHECK (beneficiary_identity_version IS NULL OR beneficiary_identity_version > 0);

ALTER TABLE wlt.approved_payout_snapshots
    ADD COLUMN beneficiary_identity_version integer,
    ADD CONSTRAINT approved_payout_snapshots_identity_version_chk CHECK (beneficiary_identity_version IS NULL OR beneficiary_identity_version > 0);
