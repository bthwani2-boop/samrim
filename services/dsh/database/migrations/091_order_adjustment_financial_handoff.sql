ALTER TABLE dsh.commerce_financial_handoff_outbox
    DROP CONSTRAINT commerce_financial_handoff_outbox_effect_chk,
    ADD CONSTRAINT commerce_financial_handoff_outbox_effect_chk CHECK (effect_type IN (
        'DELIVERY_SETTLEMENT',
        'STORE_PICKUP_COLLECTION',
        'PARTNER_CAPTAIN_STORE_CASH_COLLECTION',
        'PARTNER_CAPTAIN_BALANCE_SETTLEMENT',
        'CAPTAIN_COD_RELEASE',
        'PAYMENT_CANCEL',
        'ORDER_ADJUSTMENT_RECONCILIATION'
    )),
    DROP CONSTRAINT commerce_financial_handoff_outbox_shape_chk,
    ADD CONSTRAINT commerce_financial_handoff_outbox_shape_chk CHECK (
        (effect_type='DELIVERY_SETTLEMENT' AND amount_minor>=0 AND captain_actor_id IS NOT NULL AND partner_actor_id IS NOT NULL AND reason IS NULL)
        OR
        (effect_type='STORE_PICKUP_COLLECTION' AND amount_minor>=0 AND captain_actor_id IS NULL AND partner_actor_id IS NOT NULL AND reason IS NULL)
        OR
        (effect_type='PARTNER_CAPTAIN_STORE_CASH_COLLECTION' AND amount_minor>0 AND captain_actor_id IS NOT NULL AND partner_actor_id IS NOT NULL AND reason IS NULL)
        OR
        (effect_type='PARTNER_CAPTAIN_BALANCE_SETTLEMENT' AND amount_minor=0 AND captain_actor_id IS NULL AND partner_actor_id IS NOT NULL AND reason IS NULL)
        OR
        (effect_type='CAPTAIN_COD_RELEASE' AND amount_minor=0 AND captain_actor_id IS NOT NULL AND partner_actor_id IS NULL AND reason IS NULL)
        OR
        (effect_type='PAYMENT_CANCEL' AND amount_minor>0 AND captain_actor_id IS NULL AND partner_actor_id IS NULL AND reason IS NOT NULL)
        OR
        (effect_type='ORDER_ADJUSTMENT_RECONCILIATION' AND amount_minor=0 AND captain_actor_id IS NULL AND partner_actor_id IS NULL AND reason IS NULL)
    );
