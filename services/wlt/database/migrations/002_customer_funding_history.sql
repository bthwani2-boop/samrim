-- A read-only projection of posted funding facts. The applied baseline is immutable.
BEGIN;
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT development migration requires the isolated owner';
    END IF;
END;
$isolation$;

CREATE VIEW wlt.customer_funding_history WITH (security_barrier = true) AS
SELECT actor_id, funding_id, amount_yer, posted_at
FROM wlt.customer_funding_journal;

REVOKE ALL ON wlt.customer_funding_history FROM PUBLIC;
GRANT SELECT ON wlt.customer_funding_history TO bthwani_wlt_reader;
COMMIT;
