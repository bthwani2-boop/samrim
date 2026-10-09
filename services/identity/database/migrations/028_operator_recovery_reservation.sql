ALTER TABLE identity_operator_recovery_credentials
    ADD COLUMN reserved_by_ceremony_id text;

ALTER TABLE identity_operator_recovery_credentials
    ADD CONSTRAINT identity_operator_recovery_credential_reserved_ceremony_fk
    FOREIGN KEY (reserved_by_ceremony_id)
    REFERENCES identity_webauthn_ceremonies(id)
    ON DELETE SET NULL;

CREATE UNIQUE INDEX identity_operator_recovery_credentials_reservation_uq
    ON identity_operator_recovery_credentials (reserved_by_ceremony_id)
    WHERE reserved_by_ceremony_id IS NOT NULL;
