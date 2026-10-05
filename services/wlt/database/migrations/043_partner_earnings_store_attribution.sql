-- Per-Store economic attribution on Partner order earnings.
-- wlt.customer_payment_allocations already carries the canonical store_id for every
-- order payment; this migration carries that fact onto the earnings row so per-Store
-- readback and future recipient-routed settlement can preserve Store attribution.
-- Rows whose allocation predates store attribution keep the empty-string sentinel:
-- they stay owner-routed and are never invented. Existing payouts and committed
-- snapshots are not rewritten.

ALTER TABLE wlt.partner_order_earnings
    ADD COLUMN store_id text NOT NULL DEFAULT '';

UPDATE wlt.partner_order_earnings e
SET store_id = a.store_id
FROM wlt.customer_payment_allocations a
WHERE a.order_id = e.order_id AND a.store_id IS NOT NULL;

ALTER TABLE wlt.partner_order_earnings
    ADD CONSTRAINT partner_order_earnings_store_chk CHECK (length(btrim(store_id)) <= 128);

CREATE INDEX partner_order_earnings_partner_store_idx
    ON wlt.partner_order_earnings(partner_actor_id, store_id, created_at DESC);

-- Wallet readback per Store: aggregate attributed credits per Store for the Partner.
CREATE OR REPLACE VIEW wlt.partner_store_earning_attribution AS
SELECT e.partner_actor_id,
       e.store_id,
       COUNT(*) AS order_count,
       COALESCE(SUM(e.partner_net_minor), 0) AS partner_net_minor,
       COALESCE(SUM(e.commission_minor), 0) AS commission_minor,
       MAX(e.created_at) AS last_earning_at
FROM wlt.partner_order_earnings e
GROUP BY e.partner_actor_id, e.store_id;
