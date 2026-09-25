CREATE INDEX payment_intents_cash_custody_queue_idx
    ON wlt.payment_intents(collected_at, id)
    WHERE state='COLLECTED' AND method='CASH_ON_DELIVERY';

CREATE INDEX payment_intents_cash_custody_reference_prefix_idx
    ON wlt.payment_intents(lower(external_reference) text_pattern_ops)
    WHERE state='COLLECTED' AND method='CASH_ON_DELIVERY';

CREATE INDEX payment_intents_cash_custody_captain_prefix_idx
    ON wlt.payment_intents(lower(collected_by_actor_id) text_pattern_ops)
    WHERE state='COLLECTED' AND method='CASH_ON_DELIVERY';
