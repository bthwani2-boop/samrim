-- A client may cancel only a CREATED COD Order. WLT remains the canonical
-- payment owner; DSH records the bounded Order/payment snapshot.
ALTER TABLE dsh.commerce_orders
    DROP CONSTRAINT commerce_orders_state_chk,
    ADD CONSTRAINT commerce_orders_state_chk CHECK (state IN ('CREATED', 'PARTNER_ACCEPTED', 'PREPARING', 'READY_FOR_DISPATCH', 'CAPTAIN_ASSIGNED', 'IN_CUSTODY', 'DELIVERED', 'DELIVERY_FAILED', 'REJECTED', 'CANCELLED'));

ALTER TABLE dsh.commerce_order_transition_idempotency
    DROP CONSTRAINT commerce_order_transition_state_chk,
    ADD CONSTRAINT commerce_order_transition_state_chk CHECK (requested_state IN ('PARTNER_ACCEPTED', 'PREPARING', 'READY_FOR_DISPATCH', 'REJECTED', 'CANCELLED'));

ALTER TABLE dsh.commerce_order_audit
    DROP CONSTRAINT commerce_order_audit_event_type_chk,
    ADD CONSTRAINT commerce_order_audit_event_type_chk CHECK (event_type IN ('order_created', 'order_partner_accepted', 'order_preparing', 'order_ready_for_dispatch', 'order_rejected', 'order_cancelled'));
