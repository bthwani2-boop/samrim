-- All historic Store agreements retain explicit COMMISSION semantics (including 0% commission).
ALTER TABLE wlt.store_commercial_agreements
  ADD COLUMN commercial_model text NOT NULL DEFAULT 'COMMISSION',
  ADD COLUMN recurring_amount_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN billing_period text NOT NULL DEFAULT 'NONE',
  ADD COLUMN billing_timezone text NOT NULL DEFAULT 'Asia/Aden',
  ADD COLUMN invoice_due_days integer NOT NULL DEFAULT 0,
  ADD COLUMN grace_days integer NOT NULL DEFAULT 0,
  ADD COLUMN renewal_policy text NOT NULL DEFAULT 'NONE',
  ADD COLUMN termination_terms text NOT NULL DEFAULT '',
  ADD COLUMN adjustment_terms text NOT NULL DEFAULT '',
  ADD CONSTRAINT store_agreement_model_fields_chk CHECK (
    (commercial_model='COMMISSION' AND recurring_amount_minor=0 AND billing_period='NONE'
      AND billing_timezone='Asia/Aden' AND invoice_due_days=0 AND grace_days=0
      AND renewal_policy='NONE' AND termination_terms='' AND adjustment_terms='')
    OR (commercial_model IN ('SUBSCRIPTION','HYBRID') AND recurring_amount_minor BETWEEN 1 AND 100000000
      AND billing_period IN ('MONTHLY','ANNUAL') AND billing_timezone='Asia/Aden'
      AND invoice_due_days BETWEEN 0 AND 30 AND grace_days BETWEEN 0 AND 30
      AND renewal_policy IN ('MANUAL','AUTOMATIC')
      AND char_length(termination_terms) BETWEEN 8 AND 500
      AND char_length(adjustment_terms) BETWEEN 8 AND 500)
  ),
  ADD CONSTRAINT store_agreement_recurring_not_active_chk CHECK (
    commercial_model='COMMISSION' OR status IN ('PROPOSED','PARTNER_ACCEPTED','FINANCE_REJECTED')
  );
CREATE FUNCTION wlt.guard_store_commercial_model_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.commercial_model, OLD.recurring_amount_minor, OLD.billing_period, OLD.billing_timezone,
      OLD.invoice_due_days, OLD.grace_days, OLD.renewal_policy, OLD.termination_terms, OLD.adjustment_terms)
     IS DISTINCT FROM
     (NEW.commercial_model, NEW.recurring_amount_minor, NEW.billing_period, NEW.billing_timezone,
      NEW.invoice_due_days, NEW.grace_days, NEW.renewal_policy, NEW.termination_terms, NEW.adjustment_terms)
  THEN RAISE EXCEPTION 'store commercial agreement model and terms are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_commercial_agreement_model_immutable
  BEFORE UPDATE ON wlt.store_commercial_agreements FOR EACH ROW
  EXECUTE FUNCTION wlt.guard_store_commercial_model_immutability();
