CREATE INDEX customer_withdrawal_intakes_requested_queue_idx
    ON wlt.customer_manual_withdrawal_intakes(requested_at DESC, id DESC);

CREATE INDEX customer_withdrawal_intakes_actor_prefix_idx
    ON wlt.customer_manual_withdrawal_intakes(lower(customer_actor_id) text_pattern_ops);

CREATE INDEX customer_withdrawal_intakes_id_prefix_idx
    ON wlt.customer_manual_withdrawal_intakes(lower(id) text_pattern_ops);

CREATE INDEX customer_withdrawal_intakes_beneficiary_prefix_idx
    ON wlt.customer_manual_withdrawal_intakes(lower(beneficiary_name) text_pattern_ops);

CREATE INDEX customer_withdrawal_intakes_provider_prefix_idx
    ON wlt.customer_manual_withdrawal_intakes(lower(provider_key) text_pattern_ops);

CREATE INDEX customer_withdrawal_intakes_wallet_suffix_idx
    ON wlt.customer_manual_withdrawal_intakes(right(wallet_identifier_masked, 4));
