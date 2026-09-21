ALTER TABLE dsh.commerce_financial_handoff_outbox
    ADD COLUMN acting_actor_id text;

UPDATE dsh.commerce_financial_handoff_outbox h
SET acting_actor_id = CASE
    WHEN h.effect_type='DELIVERY_SETTLEMENT' THEN h.captain_actor_id
    WHEN h.effect_type='PAYMENT_CANCEL' AND h.reason='client_cancelled'
        THEN (SELECT o.client_actor_id FROM dsh.commerce_orders o WHERE o.id=h.order_id)
    WHEN h.effect_type='PAYMENT_CANCEL' AND h.reason='partner_rejected'
        THEN (SELECT s.partner_actor_id FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE o.id=h.order_id)
    ELSE 'financial-handoff'
END
WHERE h.acting_actor_id IS NULL;

ALTER TABLE dsh.commerce_financial_handoff_outbox
    ALTER COLUMN acting_actor_id SET NOT NULL,
    ADD CONSTRAINT commerce_financial_handoff_outbox_actor_chk CHECK (length(btrim(acting_actor_id)) BETWEEN 1 AND 128);
