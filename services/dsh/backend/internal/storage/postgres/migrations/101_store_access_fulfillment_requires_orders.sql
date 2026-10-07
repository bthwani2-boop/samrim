-- Fulfillment actions operate inside the Store order workflow. Repair any
-- historical grants that carried fulfillment without orders, then make the
-- dependency a database invariant so every surface observes usable authority.

UPDATE dsh.store_access_grants
SET permissions = array_append(permissions, 'orders'),
    version = version + 1,
    updated_at = clock_timestamp()
WHERE 'fulfillment' = ANY(permissions)
  AND NOT ('orders' = ANY(permissions));

ALTER TABLE dsh.store_access_grants
    ADD CONSTRAINT store_access_grants_fulfillment_requires_orders_chk
    CHECK (NOT ('fulfillment' = ANY(permissions)) OR 'orders' = ANY(permissions));
