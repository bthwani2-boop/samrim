-- Monetary authorization cap for total discounts. WLT remains the financial
-- ledger owner for each frozen funding split; this is NOT a ledger balance.
ALTER TABLE dsh.commerce_promotions
  ADD COLUMN discount_budget_limit_minor bigint,
  ADD COLUMN discount_spent_minor bigint NOT NULL DEFAULT 0;

-- All existing eligible redemptions remain counted on upgrade.
UPDATE dsh.commerce_promotions promotion
SET discount_spent_minor = COALESCE((
  SELECT SUM(redemption.discount_minor)
  FROM dsh.commerce_promotion_redemptions redemption
  WHERE redemption.promotion_id=promotion.id
),0);

ALTER TABLE dsh.commerce_promotions
  ADD CONSTRAINT commerce_promotions_discount_budget_chk
  CHECK (discount_budget_limit_minor IS NULL OR discount_budget_limit_minor > 0),
  ADD CONSTRAINT commerce_promotions_discount_spent_chk
  CHECK (discount_spent_minor >= 0 AND
         (discount_budget_limit_minor IS NULL OR discount_spent_minor <= discount_budget_limit_minor));
