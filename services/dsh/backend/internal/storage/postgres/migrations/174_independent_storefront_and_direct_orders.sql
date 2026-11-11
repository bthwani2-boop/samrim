-- Independent web publication and merchant-direct orders are distinct from
-- marketplace publication, checkout, dispatch, and WLT financial events.
-- No existing dsh.stores publication constraint or historical order is changed.
-- These tables alone do not authorize public publication or direct checkout.

CREATE TABLE dsh.independent_store_publications (
    store_id text PRIMARY KEY REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    state text NOT NULL DEFAULT 'DRAFT',
    version integer NOT NULL DEFAULT 1,
    terms_version text,
    terms_accepted_by_actor_id text,
    terms_accepted_at timestamptz,
    review_state text NOT NULL DEFAULT 'NOT_CHECKED',
    review_reason text,
    published_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_by_actor_id text,
    CONSTRAINT independent_store_publication_state_chk CHECK
        (state IN ('DRAFT','READY_FOR_AUTOCHECK','NEEDS_REVIEW','NEEDS_CORRECTION','PUBLISHED_INDEPENDENT','SUSPENDED','UNPUBLISHED')),
    CONSTRAINT independent_store_publication_review_chk CHECK
        (review_state IN ('NOT_CHECKED','PASSED','NEEDS_REVIEW','REJECTED')),
    CONSTRAINT independent_store_publication_version_chk CHECK (version > 0),
    CONSTRAINT independent_store_publication_terms_chk CHECK
        ((terms_version IS NULL AND terms_accepted_by_actor_id IS NULL AND terms_accepted_at IS NULL)
         OR (NULLIF(btrim(terms_version),'') IS NOT NULL AND NULLIF(btrim(terms_accepted_by_actor_id),'') IS NOT NULL AND terms_accepted_at IS NOT NULL)),
    CONSTRAINT independent_store_publication_published_chk CHECK
        (state <> 'PUBLISHED_INDEPENDENT' OR
         (review_state='PASSED' AND terms_version IS NOT NULL AND terms_accepted_at IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX independent_store_publications_state_idx
    ON dsh.independent_store_publications(state,updated_at DESC,store_id);

-- Direct Orders must snapshot the merchant's customer-facing cancellation,
-- returns, fulfillment and collection policies. Hosting consent is separate.
-- Publication needs an authorized owner/reviewer writer before public use.
CREATE TABLE dsh.independent_store_customer_policies (
    store_id text PRIMARY KEY REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    version integer NOT NULL DEFAULT 1,
    policy_version text NOT NULL,
    cancellation_terms text NOT NULL,
    returns_terms text NOT NULL,
    fulfillment_terms text NOT NULL,
    collection_terms text NOT NULL,
    authored_by_actor_id text NOT NULL,
    review_state text NOT NULL DEFAULT 'NOT_CHECKED',
    reviewed_by_actor_id text,
    published_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT independent_store_customer_policy_version_chk CHECK
        (version > 0 AND NULLIF(btrim(policy_version),'') IS NOT NULL),
    CONSTRAINT independent_store_customer_policy_terms_chk CHECK
        (NULLIF(btrim(cancellation_terms),'') IS NOT NULL
         AND NULLIF(btrim(returns_terms),'') IS NOT NULL
         AND NULLIF(btrim(fulfillment_terms),'') IS NOT NULL
         AND NULLIF(btrim(collection_terms),'') IS NOT NULL
         AND NULLIF(btrim(authored_by_actor_id),'') IS NOT NULL),
    CONSTRAINT independent_store_customer_policy_review_chk CHECK
        (review_state IN ('NOT_CHECKED','PASSED','REJECTED')
         AND (review_state <> 'PASSED' OR
              (NULLIF(btrim(reviewed_by_actor_id),'') IS NOT NULL
               AND published_at IS NOT NULL)))
);

-- A Store owner may save drafts, but may not self-approve or publish them.
-- A later authorized review writer must retain canonical Store/actor checks.
CREATE TABLE dsh.independent_store_customer_policy_idempotency (
    key_hash text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    owner_actor_id text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT independent_customer_policy_idem_hash_chk CHECK
        (key_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT independent_customer_policy_idem_result_chk CHECK
        (jsonb_typeof(result)='object')
);
CREATE INDEX independent_store_customer_policy_idem_store_idx
    ON dsh.independent_store_customer_policy_idempotency(store_id,created_at DESC);

CREATE TABLE dsh.independent_store_customer_policy_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    actor_id text NOT NULL,
    key_hash text NOT NULL UNIQUE REFERENCES dsh.independent_store_customer_policy_idempotency(key_hash) ON DELETE RESTRICT,
    correlation_id text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    policy_version text NOT NULL,
    event_type text NOT NULL DEFAULT 'DRAFT_SAVED',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT independent_customer_policy_audit_version_chk CHECK
        (expected_version >= 0 AND result_version = expected_version + 1),
    CONSTRAINT independent_customer_policy_audit_event_chk CHECK
        (event_type='DRAFT_SAVED')
);
CREATE INDEX independent_store_customer_policy_audit_store_idx
    ON dsh.independent_store_customer_policy_audit(store_id,created_at DESC);

CREATE TABLE dsh.independent_store_publication_idempotency (
    key_hash text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL REFERENCES dsh.independent_store_publications(store_id) ON DELETE RESTRICT,
    requested_state text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT independent_store_pub_idem_hash_chk CHECK (key_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT independent_store_pub_idem_version_chk CHECK (expected_version > 0 AND result_version > 0)
);

CREATE TABLE dsh.independent_store_publication_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id text NOT NULL REFERENCES dsh.independent_store_publications(store_id) ON DELETE RESTRICT,
    from_state text NOT NULL,
    to_state text NOT NULL,
    expected_version integer NOT NULL,
    result_version integer NOT NULL,
    actor_id text NOT NULL,
    reason text NOT NULL,
    key_hash text NOT NULL REFERENCES dsh.independent_store_publication_idempotency(key_hash) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT independent_store_pub_audit_version_chk CHECK (expected_version > 0 AND result_version > expected_version)
);
CREATE INDEX independent_store_publication_audit_store_idx
    ON dsh.independent_store_publication_audit(store_id,created_at DESC);

-- PII is Store-scoped; the public guest status projection must never return it.
-- A guest capability is a random secret whose SHA-256 hash is stored, with
-- short expiry. Separate owner-backed authentication is required for PII reads.
CREATE TABLE dsh.independent_direct_orders (
    id text PRIMARY KEY,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    publication_version integer NOT NULL,
    store_version integer NOT NULL,
    state text NOT NULL DEFAULT 'SUBMITTED',
    version integer NOT NULL DEFAULT 1,
    fulfillment_mode text NOT NULL,
    payment_method text NOT NULL DEFAULT 'MERCHANT_DIRECT_AT_FULFILLMENT',
    guest_name text NOT NULL,
    guest_phone_e164 text NOT NULL,
    delivery_address text,
    hosting_terms_version text NOT NULL,
    merchant_policy_version text NOT NULL,
    merchant_policy_snapshot jsonb NOT NULL,
    subtotal_amount_minor bigint NOT NULL,
    merchant_delivery_fee_minor bigint NOT NULL DEFAULT 0,
    total_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    guest_capability_hash text NOT NULL UNIQUE,
    guest_capability_expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT independent_direct_order_version_chk CHECK (version > 0 AND publication_version > 0 AND store_version > 0),
    CONSTRAINT independent_direct_order_state_chk CHECK
        (state IN ('SUBMITTED','ACCEPTED','PREPARING','READY','COMPLETED','REJECTED','CANCELLED')),
    CONSTRAINT independent_direct_order_fulfillment_chk CHECK
        (fulfillment_mode IN ('PARTNER_CAPTAIN','CUSTOMER_PICKUP')),
    CONSTRAINT independent_direct_order_payment_chk CHECK (payment_method = 'MERCHANT_DIRECT_AT_FULFILLMENT'),
    CONSTRAINT independent_direct_order_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT independent_direct_order_policy_snapshot_chk CHECK
        (NULLIF(btrim(hosting_terms_version),'') IS NOT NULL
         AND NULLIF(btrim(merchant_policy_version),'') IS NOT NULL
         AND jsonb_typeof(merchant_policy_snapshot)='object'
         AND COALESCE(jsonb_typeof(merchant_policy_snapshot->'cancellationTerms'),'')='string'
         AND COALESCE(jsonb_typeof(merchant_policy_snapshot->'returnsTerms'),'')='string'
         AND COALESCE(jsonb_typeof(merchant_policy_snapshot->'fulfillmentTerms'),'')='string'
         AND COALESCE(jsonb_typeof(merchant_policy_snapshot->'collectionTerms'),'')='string'
         AND COALESCE(btrim(merchant_policy_snapshot->>'cancellationTerms'),'')<>''
         AND COALESCE(btrim(merchant_policy_snapshot->>'returnsTerms'),'')<>''
         AND COALESCE(btrim(merchant_policy_snapshot->>'fulfillmentTerms'),'')<>''
         AND COALESCE(btrim(merchant_policy_snapshot->>'collectionTerms'),'')<>''),
    CONSTRAINT independent_direct_order_contact_chk CHECK
        (char_length(btrim(guest_name)) BETWEEN 2 AND 120
         AND guest_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT independent_direct_order_address_chk CHECK
        ((fulfillment_mode='CUSTOMER_PICKUP' AND delivery_address IS NULL)
         OR (fulfillment_mode='PARTNER_CAPTAIN' AND NULLIF(btrim(delivery_address),'') IS NOT NULL)),
    CONSTRAINT independent_direct_order_amount_chk CHECK
        (subtotal_amount_minor > 0 AND merchant_delivery_fee_minor >= 0
         AND (fulfillment_mode <> 'CUSTOMER_PICKUP' OR merchant_delivery_fee_minor = 0)
         AND total_amount_minor = subtotal_amount_minor + merchant_delivery_fee_minor),
    CONSTRAINT independent_direct_order_capability_chk CHECK
        (guest_capability_hash ~ '^[0-9a-f]{64}$')
);
-- Enforce the current commercial relation at the actual DSH write boundary.
-- FOR SHARE serializes an Order insert with a concurrent Store-model change;
-- an INSERT-only trigger deliberately leaves historical direct Orders intact
-- when an authorized future conversion changes the canonical Store relation.
CREATE FUNCTION dsh.require_independent_direct_order_store()
RETURNS trigger LANGUAGE plpgsql AS $independent_store_guard$
DECLARE current_relation text;
BEGIN
    SELECT relation_model INTO current_relation
      FROM dsh.stores
     WHERE id=NEW.store_id AND deleted_at IS NULL
     FOR SHARE;
    IF current_relation IS DISTINCT FROM 'INDEPENDENT_STORE' THEN
        RAISE EXCEPTION 'direct Orders require a current independent Store'
            USING ERRCODE='23514',
                  CONSTRAINT='independent_direct_order_store_relation_chk';
    END IF;
    RETURN NEW;
END;
$independent_store_guard$;
CREATE TRIGGER independent_direct_order_store_insert_guard
    BEFORE INSERT ON dsh.independent_direct_orders
    FOR EACH ROW EXECUTE FUNCTION dsh.require_independent_direct_order_store();

CREATE INDEX independent_direct_orders_store_idx
    ON dsh.independent_direct_orders(store_id,created_at DESC,id DESC);

-- These composite foreign keys prevent line injection across canonical Stores,
-- Offers, Variants and Products even if a caller bypasses the DSH writer.
-- One line per Offer is intentionally the initial, no-modifiers Direct MVP.
CREATE UNIQUE INDEX independent_direct_order_order_store_uq
    ON dsh.independent_direct_orders(id,store_id);
CREATE UNIQUE INDEX independent_direct_order_offer_store_variant_uq
    ON dsh.catalog_store_offers(id,store_id,variant_id);
CREATE UNIQUE INDEX independent_direct_order_variant_product_uq
    ON dsh.catalog_product_variants(id,product_id);

CREATE TABLE dsh.independent_direct_order_lines (
    order_id text NOT NULL,
    store_id text NOT NULL,
    offer_id text NOT NULL,
    product_id text NOT NULL,
    variant_id text NOT NULL,
    product_name text NOT NULL,
    variant_title text NOT NULL,
    quantity_base_units bigint NOT NULL,
    pricing_unit_base_units bigint NOT NULL,
    unit_price_minor bigint NOT NULL,
    line_amount_minor bigint NOT NULL,
    PRIMARY KEY (order_id,offer_id),
    CONSTRAINT independent_direct_line_order_scope_fk FOREIGN KEY(order_id,store_id)
        REFERENCES dsh.independent_direct_orders(id,store_id) ON DELETE RESTRICT,
    CONSTRAINT independent_direct_line_offer_scope_fk FOREIGN KEY(offer_id,store_id,variant_id)
        REFERENCES dsh.catalog_store_offers(id,store_id,variant_id) ON DELETE RESTRICT,
    CONSTRAINT independent_direct_line_variant_product_fk FOREIGN KEY(variant_id,product_id)
        REFERENCES dsh.catalog_product_variants(id,product_id) ON DELETE RESTRICT,
    CONSTRAINT independent_direct_order_lines_quantity_chk CHECK
        (quantity_base_units > 0 AND pricing_unit_base_units > 0),
    -- Server-priced line snapshots must also be arithmetically consistent
    -- if data is written outside the approved DSH transaction. NUMERIC
    -- avoids BIGINT overflow while checking the persisted equality.
    CONSTRAINT independent_direct_order_lines_price_chk CHECK
        (unit_price_minor > 0 AND line_amount_minor > 0
         AND MOD(quantity_base_units,NULLIF(pricing_unit_base_units,0))=0
         AND line_amount_minor::numeric =
             unit_price_minor::numeric * quantity_base_units::numeric /
             NULLIF(pricing_unit_base_units,0)::numeric)
);

-- Globally unique key hashes prevent the same guest attempt from being replayed
-- for another Store; request_hash binds the complete order facts at commit.
CREATE TABLE dsh.independent_direct_order_idempotency (
    key_hash text PRIMARY KEY,
    request_hash text NOT NULL,
    store_id text NOT NULL REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    order_id text NOT NULL UNIQUE REFERENCES dsh.independent_direct_orders(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT independent_direct_order_idem_hash_chk CHECK
        (key_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX independent_direct_order_idempotency_store_idx
    ON dsh.independent_direct_order_idempotency(store_id,created_at DESC);

CREATE TABLE dsh.independent_direct_order_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id text NOT NULL REFERENCES dsh.independent_direct_orders(id) ON DELETE RESTRICT,
    actor_id text NOT NULL,
    event_type text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    expected_version integer,
    result_version integer NOT NULL,
    reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT independent_direct_order_audit_state_chk CHECK
        (to_state IN ('SUBMITTED','ACCEPTED','PREPARING','READY','COMPLETED','REJECTED','CANCELLED')),
    CONSTRAINT independent_direct_order_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX independent_direct_order_audit_order_idx
    ON dsh.independent_direct_order_audit(order_id,created_at DESC);
