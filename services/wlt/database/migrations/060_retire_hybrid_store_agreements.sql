-- HYBRID is no longer an admitted Store commercial model.
-- Preserve prior immutable agreements and their financial audit histories.
-- Refuse new hybrid records and promotion of old proposals; allow historical rejection.
CREATE FUNCTION wlt.reject_retired_hybrid_store_agreement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.commercial_model = 'HYBRID' THEN
      RAISE EXCEPTION 'retired HYBRID Store commercial agreement'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.commercial_model = 'HYBRID'
      AND OLD.status = 'PROPOSED'
      AND NEW.status = 'PARTNER_ACCEPTED'
    THEN
      RAISE EXCEPTION 'retired HYBRID Store commercial agreement cannot be accepted'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER store_agreement_reject_retired_hybrid
  BEFORE INSERT OR UPDATE ON wlt.store_commercial_agreements
  FOR EACH ROW
  EXECUTE FUNCTION wlt.reject_retired_hybrid_store_agreement();
