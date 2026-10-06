-- Store-scoped delegation grows its bounded permission allowlist so UX presets
-- (Store Manager, Order Staff, Catalog Staff, Accountant, Delivery Staff) map onto
-- canonical Store-scoped grants instead of new identity roles.
-- Payout-recipient routing stays owner-only outside this allowlist; payout_request
-- never changes a recipient, and finance_read never implies payout_request.

ALTER TABLE dsh.store_access_grants
    DROP CONSTRAINT store_access_grants_permissions_chk;

ALTER TABLE dsh.store_access_grants
    ADD CONSTRAINT store_access_grants_permissions_chk CHECK (
        cardinality(permissions) BETWEEN 1 AND 7
        AND permissions <@ ARRAY[
            'orders','catalog','store_operations','promotions',
            'finance_read','payout_request','fulfillment'
        ]::text[]
    );
