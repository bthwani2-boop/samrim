ALTER TABLE wlt.captain_cod_reservations
    DROP CONSTRAINT captain_cod_reservations_order_id_key,
    DROP CONSTRAINT captain_cod_reservations_payment_intent_id_key;

CREATE UNIQUE INDEX captain_cod_reservations_active_order_uq
    ON wlt.captain_cod_reservations(order_id)
    WHERE state = 'ACTIVE';

CREATE UNIQUE INDEX captain_cod_reservations_active_payment_intent_uq
    ON wlt.captain_cod_reservations(payment_intent_id)
    WHERE state = 'ACTIVE';
