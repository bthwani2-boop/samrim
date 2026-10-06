-- WLT-owned promotion funding truth.
-- DSH freezes promotion identity and funding vocabulary on the Order; WLT owns the
-- monetary consequence. The exact funding split is derived server-side from the
-- funding source and share (never trusted from clients) and frozen at payment
-- allocation time. Historical rows are immutable; corrections are explicit
-- reversal rows rather than edits.

CREATE TABLE wlt.order_promotion_funding (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    payment_intent_id text NOT NULL,
    promotion_id text NOT NULL,
    promotion_version integer NOT NULL,
    promotion_code text NOT NULL,
    store_id text NOT NULL DEFAULT '',
    discount_minor bigint NOT NULL,
    funding_source text NOT NULL,
    partner_share_percent integer,
    partner_funded_minor bigint NOT NULL,
    bthwani_funded_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'YER',
    kind text NOT NULL DEFAULT 'ORDER',
    reversal_of text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT order_promotion_funding_id_chk CHECK (length(btrim(id)) BETWEEN 8 AND 128),
    CONSTRAINT order_promotion_funding_order_chk CHECK (btrim(order_id) <> '' AND length(order_id) <= 128),
    CONSTRAINT order_promotion_funding_intent_chk CHECK (btrim(payment_intent_id) <> ''),
    CONSTRAINT order_promotion_funding_promotion_chk CHECK (btrim(promotion_id) <> '' AND promotion_version >= 1),
    CONSTRAINT order_promotion_funding_funding_chk CHECK (funding_source IN ('PARTNER','BTHWANI','SHARED')),
    CONSTRAINT order_promotion_funding_share_chk CHECK (partner_share_percent IS NULL OR (partner_share_percent BETWEEN 1 AND 99)),
    CONSTRAINT order_promotion_funding_split_chk CHECK (
        (funding_source = 'PARTNER' AND partner_share_percent IS NULL AND partner_funded_minor = discount_minor AND bthwani_funded_minor = 0)
        OR (funding_source = 'BTHWANI' AND partner_share_percent IS NULL AND partner_funded_minor = 0 AND bthwani_funded_minor = discount_minor)
        OR (funding_source = 'SHARED' AND partner_share_percent IS NOT NULL AND partner_funded_minor >= 0 AND bthwani_funded_minor >= 0 AND partner_funded_minor + bthwani_funded_minor = discount_minor)
    ),
    CONSTRAINT order_promotion_funding_amount_chk CHECK (discount_minor > 0),
    CONSTRAINT order_promotion_funding_currency_chk CHECK (currency = 'YER'),
    CONSTRAINT order_promotion_funding_kind_chk CHECK (kind IN ('ORDER','REVERSAL') AND (kind = 'ORDER') = (reversal_of IS NULL))
);

CREATE UNIQUE INDEX order_promotion_funding_order_uq
    ON wlt.order_promotion_funding(order_id) WHERE kind = 'ORDER';

CREATE INDEX order_promotion_funding_intent_idx
    ON wlt.order_promotion_funding(payment_intent_id);
