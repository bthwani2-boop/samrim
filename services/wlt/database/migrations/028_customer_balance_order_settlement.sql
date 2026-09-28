ALTER TABLE wlt.payment_intents
    DROP CONSTRAINT payment_intents_amount_chk,
    ADD CONSTRAINT payment_intents_amount_chk CHECK (amount_minor >= 0);

ALTER TABLE wlt.payment_intents
    DROP CONSTRAINT payment_intents_collection_chk,
    ADD CONSTRAINT payment_intents_collection_chk CHECK (
        (state = 'COLLECTED' AND collected_amount_minor = amount_minor AND collected_at IS NOT NULL
            AND ((amount_minor = 0 AND collected_by_actor_id IS NULL)
                OR (amount_minor > 0 AND collected_by_actor_id IS NOT NULL)))
        OR (state <> 'COLLECTED' AND collected_amount_minor IS NULL AND collected_by_actor_id IS NULL AND collected_at IS NULL)
    );

ALTER TABLE wlt.payment_intent_events
    DROP CONSTRAINT payment_intent_events_type_chk,
    ADD CONSTRAINT payment_intent_events_type_chk CHECK (event_type IN ('PAYMENT_INTENT_CREATED', 'PAYMENT_INTENT_COLLECTED', 'PAYMENT_INTENT_BALANCE_SETTLED', 'PAYMENT_INTENT_CANCELLED'));

ALTER TABLE wlt.payment_intent_events
    DROP CONSTRAINT payment_intent_events_amount_chk,
    ADD CONSTRAINT payment_intent_events_amount_chk CHECK (
        amount_minor IS NULL OR amount_minor > 0 OR (amount_minor = 0 AND event_type IN ('PAYMENT_INTENT_CREATED', 'PAYMENT_INTENT_BALANCE_SETTLED'))
    );
