-- Commerce promotions funding vocabulary + order funding snapshot freeze
-- (COMMERCE_PROMOTIONS durable baseline).
-- Governance admits funding sources PARTNER | BTHWANI | SHARED. Existing rows were
-- merchant-borne by construction (the only previously expressible value), which is
-- exactly PARTNER-funded; the mapping is deterministic and records no new evidence.
-- Each applicable Order freezes the promotion version and funding facts required for
-- reconciliation. SHARED carries the exact partner share percent.

UPDATE dsh.commerce_promotions SET funding_source = 'PARTNER' WHERE funding_source = 'MERCHANT';

ALTER TABLE dsh.commerce_promotions DROP CONSTRAINT commerce_promotions_funding_chk;
ALTER TABLE dsh.commerce_promotions
    ADD CONSTRAINT commerce_promotions_funding_chk CHECK (funding_source IN ('PARTNER', 'BTHWANI', 'SHARED'));

ALTER TABLE dsh.commerce_promotions DROP CONSTRAINT commerce_promotions_state_chk;
ALTER TABLE dsh.commerce_promotions
    ADD CONSTRAINT commerce_promotions_state_chk CHECK (state IN ('DRAFT', 'PUBLISHED', 'PAUSED', 'ENDED'));

ALTER TABLE dsh.commerce_promotions
    ADD COLUMN funding_share_partner_percent integer;
ALTER TABLE dsh.commerce_promotions
    ADD CONSTRAINT commerce_promotions_funding_share_chk CHECK (
        (funding_source = 'SHARED' AND funding_share_partner_percent IS NOT NULL AND funding_share_partner_percent BETWEEN 1 AND 99)
        OR (funding_source IN ('PARTNER', 'BTHWANI') AND funding_share_partner_percent IS NULL)
    );

ALTER TABLE dsh.commerce_orders
    ADD COLUMN promotion_version integer,
    ADD COLUMN promotion_funding_source text,
    ADD COLUMN promotion_funding_share_partner_percent integer;
ALTER TABLE dsh.commerce_orders
    ADD CONSTRAINT commerce_orders_promotion_snapshot_chk CHECK (
        (promotion_id IS NULL AND promotion_version IS NULL AND promotion_funding_source IS NULL AND promotion_funding_share_partner_percent IS NULL)
        OR (promotion_id IS NOT NULL AND promotion_version IS NOT NULL AND promotion_version >= 1 AND promotion_funding_source IS NOT NULL AND promotion_funding_source IN ('PARTNER', 'BTHWANI', 'SHARED')
            AND ((promotion_funding_source = 'SHARED' AND promotion_funding_share_partner_percent IS NOT NULL AND promotion_funding_share_partner_percent BETWEEN 1 AND 99)
                 OR (promotion_funding_source IN ('PARTNER', 'BTHWANI') AND promotion_funding_share_partner_percent IS NULL)))
    );
