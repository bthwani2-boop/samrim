-- Minimum reader privileges, separate from owner and sandbox.
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT development migration requires the isolated owner';
    END IF;
END;
$isolation$;

GRANT USAGE ON SCHEMA wlt TO bthwani_wlt_reader;
GRANT SELECT ON wlt.customer_wallet_balances TO bthwani_wlt_reader;

REVOKE ALL ON wlt.customer_funding_history FROM PUBLIC;
GRANT SELECT ON wlt.customer_funding_history TO bthwani_wlt_reader;
