-- Commerce promotion targeting and platform-campaign opt-in.
-- Completes the admitted DSH promotion forms: product/StoreOffer discount,
-- bounded category/group discount, order-threshold discount, and platform
-- campaign with Partner opt-in. The association model never copies base
-- StoreOffer prices and never widens authorization beyond the authoring path.

ALTER TABLE dsh.commerce_promotions
    ADD COLUMN requires_partner_opt_in boolean NOT NULL DEFAULT false,
    ADD COLUMN min_order_subtotal_minor bigint;

ALTER TABLE dsh.commerce_promotions
    ADD CONSTRAINT commerce_promotions_threshold_chk CHECK (min_order_subtotal_minor IS NULL OR min_order_subtotal_minor > 0);

-- Product/category targeting: empty means the promotion applies store-wide
-- (respecting the order threshold and campaign opt-in where configured).
CREATE TABLE dsh.commerce_promotion_targets (
    promotion_id text NOT NULL REFERENCES dsh.commerce_promotions(id) ON DELETE CASCADE,
    target_kind text NOT NULL,
    target_ref text NOT NULL,
    PRIMARY KEY (promotion_id, target_kind, target_ref),
    CONSTRAINT commerce_promotion_targets_kind_chk CHECK (target_kind IN ('PRODUCT','CATEGORY')),
    CONSTRAINT commerce_promotion_targets_ref_chk CHECK (btrim(target_ref) <> '' AND length(target_ref) <= 128)
);

CREATE INDEX commerce_promotion_targets_ref_idx
    ON dsh.commerce_promotion_targets(target_kind, target_ref);

-- Partner opt-in for platform campaigns: one row per Store; absence means the
-- Store never opted in and a campaign requiring opt-in does not apply.
CREATE TABLE dsh.commerce_promotion_store_opt_ins (
    promotion_id text NOT NULL REFERENCES dsh.commerce_promotions(id) ON DELETE CASCADE,
    store_id text NOT NULL,
    actor_id text NOT NULL,
    state text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (promotion_id, store_id),
    CONSTRAINT commerce_promotion_store_opt_ins_store_chk CHECK (btrim(store_id) <> '' AND length(store_id) <= 128),
    CONSTRAINT commerce_promotion_store_opt_ins_actor_chk CHECK (btrim(actor_id) <> '' AND length(actor_id) <= 128),
    CONSTRAINT commerce_promotion_store_opt_ins_state_chk CHECK (state IN ('OPTED_IN','DECLINED')),
    CONSTRAINT commerce_promotion_store_opt_ins_version_chk CHECK (version > 0)
);

CREATE INDEX commerce_promotion_store_opt_ins_store_idx
    ON dsh.commerce_promotion_store_opt_ins(store_id);
