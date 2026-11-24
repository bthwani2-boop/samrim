-- Isolated WLT owner preparation for BTH-17. A reservation is not a charge,
-- payable quote, accepted agreement, COD admission, or posted journal.
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT reservation baseline requires isolated owner';
    END IF;
END;
$isolation$;

CREATE TABLE wlt.order_wallet_reservations (
    checkout_id text PRIMARY KEY CHECK (checkout_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128 AND btrim(actor_id)=actor_id AND actor_id !~ '[[:cntrl:]]'),
    store_id text NOT NULL CHECK (store_id ~ '^[a-z0-9-]{1,64}$'),
    quote_digest text NOT NULL CHECK (quote_digest ~ '^[0-9a-f]{64}$'),
    method text NOT NULL CHECK (method IN ('WALLET','MIXED')),
    total_yer bigint NOT NULL CHECK (total_yer > 0),
    wallet_yer bigint NOT NULL CHECK (wallet_yer > 0 AND wallet_yer <= total_yer),
    currency text NOT NULL DEFAULT 'YER' CHECK (currency='YER'),
    recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    CHECK ((method='WALLET' AND wallet_yer=total_yer) OR (method='MIXED' AND wallet_yer<total_yer))
);
CREATE INDEX order_wallet_reservations_actor ON wlt.order_wallet_reservations(actor_id);
CREATE TABLE wlt.order_wallet_releases (
    checkout_id text PRIMARY KEY REFERENCES wlt.order_wallet_reservations(checkout_id),
    operation_id text NOT NULL UNIQUE CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300 AND reason=btrim(reason) AND reason !~ '[[:cntrl:]]'),
    recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE TRIGGER order_wallet_reservations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
ON wlt.order_wallet_reservations FOR EACH STATEMENT EXECUTE FUNCTION wlt.reject_funding_rewrite();
CREATE TRIGGER order_wallet_releases_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
ON wlt.order_wallet_releases FOR EACH STATEMENT EXECUTE FUNCTION wlt.reject_funding_rewrite();

-- One derived read model: posted journal minus outstanding reservations.
-- Expose aggregate amounts only, not the private reservation identities or quotes.
CREATE VIEW wlt.customer_wallet_availability WITH (security_barrier=true) AS
SELECT b.actor_id,b.balance_yer,
       b.balance_yer-COALESCE((
           SELECT sum(r.wallet_yer) FROM wlt.order_wallet_reservations r
           WHERE r.actor_id=b.actor_id
             AND NOT EXISTS (SELECT 1 FROM wlt.order_wallet_releases x WHERE x.checkout_id=r.checkout_id)
       ),0) AS available_yer
FROM wlt.customer_wallet_balances b;
REVOKE ALL ON wlt.customer_wallet_availability FROM PUBLIC;
GRANT SELECT ON wlt.customer_wallet_availability TO bthwani_wlt_reader;

CREATE FUNCTION wlt.available_order_wallet_yer(p_actor text) RETURNS numeric
LANGUAGE sql STABLE SET search_path=pg_catalog AS $available$
    SELECT COALESCE((SELECT available_yer FROM wlt.customer_wallet_availability WHERE actor_id=p_actor),0);
$available$;

-- Owner-only transaction boundary until DSH quote authenticity, current Identity
-- authorization, effective terms and a dedicated least-privilege command are implemented.
CREATE FUNCTION wlt.reserve_order_wallet(p_checkout text,p_actor text,p_store text,p_digest text,p_method text,p_total bigint,p_wallet bigint)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $reserve$
DECLARE prior wlt.order_wallet_reservations%ROWTYPE;
BEGIN
    IF current_database()<>'bthwani_wlt_test' OR current_user<>'bthwani_wlt_owner'
        OR current_setting('transaction_isolation')<>'read committed' THEN
        RAISE EXCEPTION 'isolated owner/read committed required' USING ERRCODE='42501';
    END IF;
    IF p_checkout IS NULL OR p_checkout !~ '^[A-Za-z0-9._-]{8,128}$'
       OR p_actor IS NULL OR char_length(p_actor) NOT BETWEEN 1 AND 128 OR p_actor<>btrim(p_actor) OR p_actor ~ '[[:cntrl:]]'
       OR p_store IS NULL OR p_store !~ '^[a-z0-9-]{1,64}$'
       OR p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
       OR p_method IS NULL OR p_method NOT IN ('WALLET','MIXED')
       OR p_total IS NULL OR p_total<=0 OR p_wallet IS NULL OR p_wallet<=0 OR p_wallet>p_total
       OR (p_method='WALLET' AND p_wallet<>p_total) OR (p_method='MIXED' AND p_wallet>=p_total) THEN
        RAISE EXCEPTION 'invalid reservation' USING ERRCODE='23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('wlt:wallet:'||p_actor,0));
    SELECT * INTO prior FROM wlt.order_wallet_reservations WHERE checkout_id=p_checkout;
    IF FOUND THEN
        IF ROW(prior.actor_id,prior.store_id,prior.quote_digest,prior.method,prior.total_yer,prior.wallet_yer)
           IS DISTINCT FROM ROW(p_actor,p_store,p_digest,p_method,p_total,p_wallet) THEN
            RAISE EXCEPTION 'checkout payload conflict' USING ERRCODE='23505';
        END IF;
        IF EXISTS(SELECT 1 FROM wlt.order_wallet_releases WHERE checkout_id=p_checkout) THEN RETURN 'RELEASED'; END IF;
        RETURN 'REPLAYED';
    END IF;
    IF wlt.available_order_wallet_yer(p_actor)<p_wallet THEN
        RAISE EXCEPTION 'insufficient available wallet funding' USING ERRCODE='23514';
    END IF;
    INSERT INTO wlt.order_wallet_reservations(checkout_id,actor_id,store_id,quote_digest,method,total_yer,wallet_yer)
        VALUES(p_checkout,p_actor,p_store,p_digest,p_method,p_total,p_wallet);
    RETURN 'RESERVED';
END;
$reserve$;

CREATE FUNCTION wlt.release_order_wallet(p_checkout text,p_actor text,p_operation text,p_reason text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $release$
DECLARE prior wlt.order_wallet_releases%ROWTYPE;
BEGIN
    IF current_database()<>'bthwani_wlt_test' OR current_user<>'bthwani_wlt_owner'
        OR current_setting('transaction_isolation')<>'read committed' THEN
        RAISE EXCEPTION 'isolated owner/read committed required' USING ERRCODE='42501';
    END IF;
    IF p_checkout IS NULL OR p_actor IS NULL OR p_operation IS NULL OR p_operation !~ '^[A-Za-z0-9._-]{8,128}$'
        OR p_reason IS NULL OR char_length(p_reason) NOT BETWEEN 1 AND 300 OR p_reason<>btrim(p_reason) OR p_reason ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'invalid release' USING ERRCODE='23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('wlt:wallet:'||p_actor,0));
    IF NOT EXISTS(SELECT 1 FROM wlt.order_wallet_reservations WHERE checkout_id=p_checkout AND actor_id=p_actor) THEN
        RAISE EXCEPTION 'reservation unavailable' USING ERRCODE='23514';
    END IF;
    SELECT * INTO prior FROM wlt.order_wallet_releases WHERE checkout_id=p_checkout;
    IF FOUND THEN
        IF prior.operation_id<>p_operation OR prior.reason<>p_reason THEN
            RAISE EXCEPTION 'release payload conflict' USING ERRCODE='23505';
        END IF;
        RETURN 'REPLAYED';
    END IF;
    INSERT INTO wlt.order_wallet_releases(checkout_id,operation_id,reason) VALUES(p_checkout,p_operation,p_reason);
    RETURN 'RELEASED';
END;
$release$;

-- The existing funding writer must not reverse money already reserved. Both
-- paths serialize on the same actor lock, and retries of existing reversals
-- remain safe. No automatic release on timeouts or uncertain financial state.
CREATE FUNCTION wlt.guard_reserved_funding_reversal() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
BEGIN
    IF current_setting('transaction_isolation')<>'read committed' THEN
        RAISE EXCEPTION 'read committed required for funding reversal' USING ERRCODE='42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('wlt:wallet:'||NEW.actor_id,0));
    IF NOT EXISTS(SELECT 1 FROM wlt.customer_funding_journal WHERE reverses_funding_id=NEW.reverses_funding_id)
       AND wlt.available_order_wallet_yer(NEW.actor_id)<NEW.amount_yer THEN
        RAISE EXCEPTION 'funding reserved or insufficient' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$guard$;
CREATE TRIGGER customer_funding_reservation_guard BEFORE INSERT ON wlt.customer_funding_journal
FOR EACH ROW WHEN (NEW.reverses_funding_id IS NOT NULL) EXECUTE FUNCTION wlt.guard_reserved_funding_reversal();

REVOKE ALL ON wlt.order_wallet_reservations,wlt.order_wallet_releases FROM PUBLIC;
REVOKE ALL ON FUNCTION wlt.available_order_wallet_yer(text),wlt.reserve_order_wallet(text,text,text,text,text,bigint,bigint),
    wlt.release_order_wallet(text,text,text,text),wlt.guard_reserved_funding_reversal() FROM PUBLIC;
