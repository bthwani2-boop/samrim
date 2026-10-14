CREATE INDEX commerce_order_audit_picked_up_created_idx
    ON dsh.commerce_order_audit(created_at, order_id)
    WHERE event_type = 'order_picked_up';

CREATE INDEX captain_audit_delivery_completed_created_idx
    ON dsh.captain_audit(created_at, order_id)
    WHERE event_type = 'delivery_completed';
