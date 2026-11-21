BEGIN;
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT development migration requires the isolated owner';
    END IF;
END;
$isolation$;

ALTER TABLE wlt.customer_funding_journal
    ADD COLUMN reverses_funding_id text UNIQUE REFERENCES wlt.customer_funding_journal(funding_id),
    ADD CONSTRAINT customer_funding_reversal_provider
        CHECK ((reverses_funding_id IS NOT NULL) = (provider_id = 'sandbox-reversal'));

CREATE FUNCTION wlt.verify_sandbox_funding_reversal() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $verification$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM wlt.customer_funding_journal AS original
        WHERE original.funding_id = NEW.reverses_funding_id
          AND original.provider_id = 'sandbox'
          AND original.provider_reference = NEW.provider_reference
          AND original.actor_id = NEW.actor_id
          AND original.amount_yer = NEW.amount_yer
          AND original.currency = NEW.currency
          AND original.posted_at <= NEW.posted_at
    ) THEN
        RAISE EXCEPTION 'Reversal must match the original sandbox posting' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$verification$;
REVOKE ALL ON FUNCTION wlt.verify_sandbox_funding_reversal() FROM PUBLIC;
CREATE TRIGGER customer_funding_reversal_matches_original
BEFORE INSERT ON wlt.customer_funding_journal
FOR EACH ROW WHEN (NEW.reverses_funding_id IS NOT NULL)
EXECUTE FUNCTION wlt.verify_sandbox_funding_reversal();

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

CREATE FUNCTION wlt.reverse_sandbox_customer_funding(reference text, customer text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $reversal$
DECLARE
    original_id text := 'sandbox-' || reference;
    reversal_id text := 'sandbox_reversal-' || reference;
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR session_user <> 'bthwani_wlt_sandbox' THEN
        RAISE EXCEPTION 'sandbox funding is isolated' USING ERRCODE = '42501';
    END IF;
    IF reference IS NULL OR reference !~ '^[a-z0-9-]{8,64}$' THEN
        RAISE EXCEPTION 'invalid synthetic reference' USING ERRCODE = '23514';
    END IF;

    INSERT INTO wlt.customer_funding_journal
        (funding_id, actor_id, provider_id, provider_reference, amount_yer, currency, posted_at, reverses_funding_id)
    SELECT reversal_id, actor_id, 'sandbox-reversal', provider_reference, amount_yer, currency,
           GREATEST(clock_timestamp(), posted_at), funding_id
    FROM wlt.customer_funding_journal
    WHERE funding_id = original_id AND provider_id = 'sandbox'
      AND provider_reference = reference AND actor_id = customer
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
        RETURN 'REVERSED';
    END IF;

    IF EXISTS (
        SELECT 1 FROM wlt.customer_funding_journal
        WHERE funding_id = reversal_id AND reverses_funding_id = original_id AND actor_id = customer
    ) THEN
        RETURN 'REPLAYED';
    END IF;
    RETURN 'UNAVAILABLE';
END;
$reversal$;
REVOKE ALL ON FUNCTION wlt.reverse_sandbox_customer_funding(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wlt.reverse_sandbox_customer_funding(text, text) TO bthwani_wlt_sandbox;
COMMIT;
