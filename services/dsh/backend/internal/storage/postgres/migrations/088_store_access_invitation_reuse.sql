DROP INDEX IF EXISTS dsh.store_access_grants_current_delegate_uq;

CREATE UNIQUE INDEX store_access_grants_current_delegate_uq
    ON dsh.store_access_grants(store_id, delegate_actor_id)
    WHERE state IN ('pending_role_admission','pending_partner_activation','active','suspended');

CREATE INDEX store_access_grants_store_delegate_idx
    ON dsh.store_access_grants(store_id, delegate_actor_id, state, expires_at DESC);
