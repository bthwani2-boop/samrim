-- Isolated sandbox posting, never regular runtime authority.
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT development migration requires the isolated owner';
    END IF;
END;
$isolation$;

CREATE FUNCTION wlt.post_sandbox_customer_funding(reference text, customer text, whole_yer bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $posting$
DECLARE
    existing_actor text;
    existing_amount bigint;
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR session_user <> 'bthwani_wlt_sandbox' THEN
        RAISE EXCEPTION 'sandbox funding is isolated' USING ERRCODE = '42501';
    END IF;
    IF reference IS NULL OR reference !~ '^[a-z0-9-]{8,64}$' OR whole_yer IS NULL OR whole_yer < 1 THEN
        RAISE EXCEPTION 'invalid synthetic posting' USING ERRCODE = '23514';
    END IF;

    INSERT INTO wlt.customer_funding_journal (funding_id, actor_id, provider_id, provider_reference, amount_yer)
    VALUES ('sandbox-' || reference, customer, 'sandbox', reference, whole_yer)
    -- Concurrent replays can collide on either unique index.
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
        RETURN 'POSTED';
    END IF;

    SELECT actor_id, amount_yer INTO existing_actor, existing_amount
    FROM wlt.customer_funding_journal
    WHERE funding_id = 'sandbox-' || reference AND provider_id = 'sandbox' AND provider_reference = reference;
    IF existing_actor = customer AND existing_amount = whole_yer THEN
        RETURN 'REPLAYED';
    END IF;
    RETURN 'CONFLICT';
END;
$posting$;
REVOKE ALL ON FUNCTION wlt.post_sandbox_customer_funding(text, text, bigint) FROM PUBLIC;
GRANT USAGE ON SCHEMA wlt TO bthwani_wlt_sandbox;
GRANT EXECUTE ON FUNCTION wlt.post_sandbox_customer_funding(text, text, bigint) TO bthwani_wlt_sandbox;
