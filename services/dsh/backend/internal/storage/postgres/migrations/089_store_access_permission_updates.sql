ALTER TABLE dsh.store_access_grant_idempotency
    DROP CONSTRAINT store_access_grant_idem_operation_chk,
    ADD CONSTRAINT store_access_grant_idem_operation_chk
        CHECK (operation IN ('invitation_create','role_admission_confirm','invitation_accept','invitation_decline','grant_transition','grant_permissions_update','partner_activation_confirm'));

ALTER TABLE dsh.store_access_grant_audit
    DROP CONSTRAINT store_access_grant_audit_event_chk,
    ADD CONSTRAINT store_access_grant_audit_event_chk
        CHECK (event_type IN ('invitation_created','role_admission_confirmed','invitation_accepted','invitation_declined','grant_state_changed','grant_permissions_changed','partner_activation_confirmed'));
