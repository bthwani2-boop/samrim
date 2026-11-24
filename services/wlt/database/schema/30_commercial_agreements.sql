-- Fresh isolated WLT baseline: proposed Store terms are not accepted agreements.
-- No payment, wallet, invoice, entitlement or checkout authority is created here.
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT commercial agreement baseline requires the isolated owner';
    END IF;
END;
$isolation$;

CREATE TABLE wlt.store_commercial_agreement_proposals (
    store_id text NOT NULL CHECK (store_id ~ '^[a-z0-9-]{1,64}$'),
    version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    operation_id text NOT NULL UNIQUE CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    store_relation text NOT NULL CHECK (store_relation IN ('MARKETPLACE','DIRECT')),
    fee_model text NOT NULL CHECK (fee_model IN ('COMMISSION','SUBSCRIPTION')),
    collector text NOT NULL CHECK (collector IN ('PLATFORM_MANAGED','STORE_MANAGED')),
    currency text NOT NULL DEFAULT 'YER' CHECK (currency = 'YER'),
    commission_basis_points integer,
    subscription_amount_yer bigint,
    subscription_period_days integer,
    fulfillment_modes text[] NOT NULL CHECK (
        array_ndims(fulfillment_modes) = 1 AND array_lower(fulfillment_modes,1) = 1
        AND cardinality(fulfillment_modes) BETWEEN 1 AND 3
        AND array_position(fulfillment_modes,NULL) IS NULL
        AND fulfillment_modes <@ ARRAY['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[]
        AND cardinality(fulfillment_modes) =
            ('BTHWANI_CAPTAIN' = ANY(fulfillment_modes))::integer
            + ('PARTNER_CAPTAIN' = ANY(fulfillment_modes))::integer
            + ('CUSTOMER_PICKUP' = ANY(fulfillment_modes))::integer
    ),
    proposed_effective_at timestamptz NOT NULL CHECK (isfinite(proposed_effective_at)),
    proposed_by_actor text NOT NULL CHECK (char_length(proposed_by_actor) BETWEEN 1 AND 128
        AND btrim(proposed_by_actor)=proposed_by_actor AND proposed_by_actor !~ '[[:cntrl:]]'),
    change_reason text NOT NULL CHECK (char_length(change_reason) BETWEEN 1 AND 300
        AND btrim(change_reason)=change_reason AND change_reason !~ '[[:cntrl:]]'),
    recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
    PRIMARY KEY (store_id, version),
    CHECK (
        (fee_model = 'COMMISSION' AND commission_basis_points IS NOT NULL
            AND commission_basis_points BETWEEN 0 AND 10000
            AND subscription_amount_yer IS NULL AND subscription_period_days IS NULL)
        OR (fee_model = 'SUBSCRIPTION' AND commission_basis_points IS NULL
            AND subscription_amount_yer IS NOT NULL AND subscription_amount_yer > 0
            AND subscription_period_days IS NOT NULL AND subscription_period_days > 0)
    )
);

CREATE FUNCTION wlt.reject_commercial_proposal_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $immutable$
BEGIN
    RAISE EXCEPTION 'Recorded WLT commercial proposals are immutable' USING ERRCODE = '23514';
END;
$immutable$;
CREATE TRIGGER commercial_proposal_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON wlt.store_commercial_agreement_proposals
FOR EACH STATEMENT EXECUTE FUNCTION wlt.reject_commercial_proposal_rewrite();

-- Owner-only preparation boundary. The eventual authenticated WLT agreement
-- command must verify current Identity rights and DSH Store relation first.
-- This function deliberately records no consent, effective agreement or charge.
CREATE FUNCTION wlt.append_commercial_agreement_proposal(
    p_store_id text, p_expected_version bigint, p_operation_id text,
    p_relation text, p_fee_model text, p_collector text,
    p_commission_basis_points integer, p_subscription_amount_yer bigint,
    p_subscription_period_days integer, p_fulfillment_modes text[],
    p_effective_at timestamptz, p_actor text, p_reason text
) RETURNS TABLE(version bigint, replay boolean)
LANGUAGE plpgsql SET search_path = pg_catalog AS $append$
DECLARE
    prior wlt.store_commercial_agreement_proposals%ROWTYPE;
    current_version bigint;
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT proposal requires isolated owner' USING ERRCODE = '42501';
    END IF;
    IF p_store_id IS NULL OR p_store_id !~ '^[a-z0-9-]{1,64}$'
        OR p_expected_version IS NULL OR p_expected_version < 0 OR p_expected_version >= 9007199254740991
        OR p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9._-]{8,128}$' THEN
        RAISE EXCEPTION 'Invalid proposal identity or version' USING ERRCODE = '23514';
    END IF;
    -- A single Store's successor version is decided after obtaining its lock.
    PERFORM pg_advisory_xact_lock(hashtextextended('wlt:commercial-proposal:' || p_store_id,0));
    SELECT p.* INTO prior FROM wlt.store_commercial_agreement_proposals p
        WHERE p.operation_id = p_operation_id;
    IF FOUND THEN
        IF ROW(prior.store_id,prior.version-1,prior.store_relation,prior.fee_model,
            prior.collector,prior.commission_basis_points,prior.subscription_amount_yer,
            prior.subscription_period_days,prior.fulfillment_modes,prior.proposed_effective_at,
            prior.proposed_by_actor,prior.change_reason)
            IS DISTINCT FROM ROW(p_store_id,p_expected_version,p_relation,p_fee_model,
            p_collector,p_commission_basis_points,p_subscription_amount_yer,
            p_subscription_period_days,p_fulfillment_modes,p_effective_at,p_actor,p_reason) THEN
            RAISE EXCEPTION 'Proposal operation reused with different terms' USING ERRCODE = '23505';
        END IF;
        RETURN QUERY SELECT prior.version,true;
        RETURN;
    END IF;
    SELECT COALESCE(max(p.version),0) INTO current_version
        FROM wlt.store_commercial_agreement_proposals p WHERE p.store_id=p_store_id;
    IF current_version <> p_expected_version THEN
        RAISE EXCEPTION 'Stale proposal version' USING ERRCODE = '40001';
    END IF;
    INSERT INTO wlt.store_commercial_agreement_proposals(
        store_id,version,operation_id,store_relation,fee_model,collector,
        commission_basis_points,subscription_amount_yer,subscription_period_days,
        fulfillment_modes,proposed_effective_at,proposed_by_actor,change_reason
    ) VALUES (
        p_store_id,current_version+1,p_operation_id,p_relation,p_fee_model,p_collector,
        p_commission_basis_points,p_subscription_amount_yer,p_subscription_period_days,
        p_fulfillment_modes,p_effective_at,p_actor,p_reason
    );
    RETURN QUERY SELECT current_version+1,false;
END;
$append$;

REVOKE ALL ON wlt.store_commercial_agreement_proposals FROM PUBLIC;
REVOKE ALL ON FUNCTION wlt.reject_commercial_proposal_rewrite() FROM PUBLIC;
REVOKE ALL ON FUNCTION wlt.append_commercial_agreement_proposal(
    text,bigint,text,text,text,text,integer,bigint,integer,text[],timestamptz,text,text
) FROM PUBLIC;
