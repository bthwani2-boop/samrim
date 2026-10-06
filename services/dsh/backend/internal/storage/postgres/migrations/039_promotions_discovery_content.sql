ALTER TABLE dsh.commerce_orders
    ADD COLUMN IF NOT EXISTS subtotal_amount_minor bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_minor bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS promotion_id text,
    ADD COLUMN IF NOT EXISTS promotion_code text;

CREATE TABLE dsh.commerce_promotions (
    id text PRIMARY KEY,
    code text NOT NULL,
    name_ar text NOT NULL,
    description_ar text NOT NULL DEFAULT '',
    kind text NOT NULL,
    value_minor bigint NOT NULL,
    max_discount_minor bigint,
    funding_source text NOT NULL DEFAULT 'MERCHANT',
    store_id text,
    service_city_id text,
    state text NOT NULL DEFAULT 'DRAFT',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    redemption_limit bigint,
    redeemed_count bigint NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 1,
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_promotions_code_chk CHECK (code = upper(code) AND length(code) BETWEEN 3 AND 64),
    CONSTRAINT commerce_promotions_name_chk CHECK (length(btrim(name_ar)) BETWEEN 2 AND 160),
    CONSTRAINT commerce_promotions_kind_chk CHECK (kind IN ('PERCENTAGE', 'FIXED')),
    CONSTRAINT commerce_promotions_value_chk CHECK (value_minor > 0),
    CONSTRAINT commerce_promotions_percentage_chk CHECK (kind <> 'PERCENTAGE' OR value_minor <= 100),
    CONSTRAINT commerce_promotions_max_discount_chk CHECK (max_discount_minor IS NULL OR max_discount_minor > 0),
    CONSTRAINT commerce_promotions_funding_chk CHECK (funding_source IN ('MERCHANT')),
    CONSTRAINT commerce_promotions_state_chk CHECK (state IN ('DRAFT', 'PUBLISHED', 'PAUSED')),
    CONSTRAINT commerce_promotions_window_chk CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT commerce_promotions_limit_chk CHECK (redemption_limit IS NULL OR redemption_limit > 0),
    CONSTRAINT commerce_promotions_redeemed_chk CHECK (redeemed_count >= 0 AND (redemption_limit IS NULL OR redeemed_count <= redemption_limit)),
    CONSTRAINT commerce_promotions_version_chk CHECK (version > 0),
    CONSTRAINT commerce_promotions_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_promotions_city_fk FOREIGN KEY (service_city_id) REFERENCES dsh.service_cities(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX commerce_promotions_code_uq ON dsh.commerce_promotions(code);
CREATE INDEX commerce_promotions_public_idx ON dsh.commerce_promotions(service_city_id, store_id, state, starts_at, ends_at);

CREATE TABLE dsh.commerce_promotion_redemptions (
    id text PRIMARY KEY,
    promotion_id text NOT NULL,
    client_actor_id text NOT NULL,
    order_id text NOT NULL UNIQUE,
    code text NOT NULL,
    discount_minor bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_promotion_redemptions_discount_chk CHECK (discount_minor > 0),
    CONSTRAINT commerce_promotion_redemptions_promotion_fk FOREIGN KEY (promotion_id) REFERENCES dsh.commerce_promotions(id) ON DELETE RESTRICT,
    CONSTRAINT commerce_promotion_redemptions_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX commerce_promotion_redemptions_client_promotion_uq
    ON dsh.commerce_promotion_redemptions(promotion_id, client_actor_id);
CREATE INDEX commerce_promotion_redemptions_promotion_idx
    ON dsh.commerce_promotion_redemptions(promotion_id, created_at DESC);

CREATE TABLE dsh.discovery_content (
    id text PRIMARY KEY,
    kind text NOT NULL,
    title_ar text NOT NULL,
    body_ar text NOT NULL DEFAULT '',
    media_uri text NOT NULL DEFAULT '',
    target_type text NOT NULL,
    target_id text,
    service_city_id text,
    state text NOT NULL DEFAULT 'DRAFT',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    ordinal integer NOT NULL DEFAULT 0,
    version integer NOT NULL DEFAULT 1,
    created_by_actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT discovery_content_kind_chk CHECK (kind IN ('BANNER', 'CAROUSEL', 'SHORT_FORM')),
    CONSTRAINT discovery_content_title_chk CHECK (length(btrim(title_ar)) BETWEEN 2 AND 160),
    CONSTRAINT discovery_content_target_type_chk CHECK (target_type IN ('STORE', 'PRODUCT', 'CATEGORY', 'PROMOTION', 'INFO')),
    CONSTRAINT discovery_content_target_chk CHECK ((target_type = 'INFO' AND target_id IS NULL) OR (target_type <> 'INFO' AND length(btrim(COALESCE(target_id, ''))) > 0)),
    CONSTRAINT discovery_content_state_chk CHECK (state IN ('DRAFT', 'PUBLISHED', 'PAUSED')),
    CONSTRAINT discovery_content_window_chk CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT discovery_content_ordinal_chk CHECK (ordinal >= 0),
    CONSTRAINT discovery_content_version_chk CHECK (version > 0)
);
CREATE INDEX discovery_content_public_idx ON dsh.discovery_content(service_city_id, state, ordinal, starts_at, ends_at);

CREATE TABLE dsh.commerce_marketing_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    operation text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commerce_marketing_idempotency_resource_chk CHECK (resource_type IN ('PROMOTION', 'DISCOVERY_CONTENT')),
    CONSTRAINT commerce_marketing_idempotency_operation_chk CHECK (operation IN ('CREATE', 'UPDATE', 'PUBLISH'))
);
