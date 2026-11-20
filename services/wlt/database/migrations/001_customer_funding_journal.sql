-- First WLT schema for a disposable development database.
-- The migration owner and the read-only HTTP runtime have separate roles.
BEGIN;
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT development migration requires the isolated owner';
    END IF;
END;
$isolation$;

CREATE SCHEMA wlt;
REVOKE ALL ON SCHEMA wlt FROM PUBLIC;

-- One row fixes both legs of a posted Customer funding journal to one amount.
-- The funding operation and the external evidence each identify at most one row.
CREATE TABLE wlt.customer_funding_journal (
    funding_id text PRIMARY KEY CHECK (funding_id ~ '^[a-zA-Z0-9._-]{8,128}$'),
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128 AND btrim(actor_id) = actor_id),
    provider_id text NOT NULL CHECK (provider_id ~ '^[a-z0-9-]{1,64}$'),
    provider_reference text NOT NULL CHECK (char_length(provider_reference) BETWEEN 1 AND 128 AND btrim(provider_reference) = provider_reference),
    amount_yer bigint NOT NULL CHECK (amount_yer > 0),
    currency text NOT NULL DEFAULT 'YER' CHECK (currency = 'YER'),
    posted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    UNIQUE (provider_id, provider_reference)
);
CREATE INDEX customer_funding_actor ON wlt.customer_funding_journal (actor_id);

CREATE FUNCTION wlt.reject_funding_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $immutable$
BEGIN
    RAISE EXCEPTION 'Posted WLT journals are immutable' USING ERRCODE = '23514';
END;
$immutable$;
CREATE TRIGGER customer_funding_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON wlt.customer_funding_journal
FOR EACH STATEMENT EXECUTE FUNCTION wlt.reject_funding_rewrite();

CREATE VIEW wlt.customer_funding_entries AS
SELECT funding_id, actor_id, 'funding_clearing'::text AS account, 'debit'::text AS side, amount_yer, currency
FROM wlt.customer_funding_journal
UNION ALL
SELECT funding_id, actor_id, 'customer_wallet_liability'::text, 'credit'::text, amount_yer, currency
FROM wlt.customer_funding_journal;

CREATE VIEW wlt.customer_wallet_balances AS
SELECT actor_id, sum(amount_yer) AS balance_yer
FROM wlt.customer_funding_entries WHERE side = 'credit'
GROUP BY actor_id;

GRANT USAGE ON SCHEMA wlt TO bthwani_wlt_reader;
GRANT SELECT ON wlt.customer_wallet_balances TO bthwani_wlt_reader;
COMMIT;
