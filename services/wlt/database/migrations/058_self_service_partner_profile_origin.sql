-- Preserve a Store's truthful DSH joining source through the WLT financial profile.
ALTER TABLE wlt.partner_financial_profiles
  DROP CONSTRAINT partner_financial_profiles_origin_chk,
  ADD CONSTRAINT partner_financial_profiles_origin_chk CHECK (origin IN ('field','control_panel','self_service'));
