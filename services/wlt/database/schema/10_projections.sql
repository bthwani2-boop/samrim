-- Current read projections and reversal accounting.
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT development migration requires the isolated owner';
    END IF;
END;
$isolation$;

CREATE OR REPLACE VIEW wlt.customer_funding_entries AS
SELECT funding_id, actor_id, 'funding_clearing'::text AS account,
       CASE WHEN reverses_funding_id IS NULL THEN 'debit' ELSE 'credit' END AS side, amount_yer, currency
FROM wlt.customer_funding_journal
UNION ALL
SELECT funding_id, actor_id, 'customer_wallet_liability'::text,
       CASE WHEN reverses_funding_id IS NULL THEN 'credit' ELSE 'debit' END, amount_yer, currency
FROM wlt.customer_funding_journal;

CREATE OR REPLACE VIEW wlt.customer_wallet_balances AS
SELECT actor_id, sum(CASE side WHEN 'credit' THEN amount_yer ELSE -amount_yer END) AS balance_yer
FROM wlt.customer_funding_entries WHERE account = 'customer_wallet_liability'
GROUP BY actor_id;

CREATE OR REPLACE VIEW wlt.customer_funding_history WITH (security_barrier = true) AS
SELECT actor_id, funding_id, amount_yer, posted_at, reverses_funding_id
FROM wlt.customer_funding_journal;
