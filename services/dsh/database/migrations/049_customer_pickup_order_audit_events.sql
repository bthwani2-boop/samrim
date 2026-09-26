ALTER TABLE dsh.commerce_order_audit
    DROP CONSTRAINT commerce_order_audit_event_type_chk,
    ADD CONSTRAINT commerce_order_audit_event_type_chk CHECK (
        event_type IN (
            'order_created',
            'order_partner_accepted',
            'order_preparing',
            'order_ready_for_dispatch',
            'order_rejected',
            'order_cancelled',
            'order_ready_for_pickup',
            'order_picked_up'
        )
    );
