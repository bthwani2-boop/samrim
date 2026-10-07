-- Readiness is scoped to the included Store allocations. An unrelated Store
-- under the same Partner must not block an authorized selected-Store request.
DROP TRIGGER payout_requests_recipient_review_guard ON wlt.payout_requests;
DROP FUNCTION wlt.guard_payout_request_recipient_review();

-- A legacy payout can be attributed only when all wallet credits available at
-- its creation came from exactly one known Store. Multi-Store/unknown history
-- remains explicit; never invent a proportional historical allocation.
INSERT INTO wlt.payout_store_allocations(payout_id,store_id,beneficiary_actor_id,recipient_assignment_version,amount_minor,currency)
SELECT p.id,source.store_id,d.actor_id,0,p.resolved_amount_minor,p.currency
FROM wlt.payout_requests p
JOIN wlt.official_wallet_destinations d ON d.id=p.destination_id
JOIN LATERAL (
    SELECT MIN(e.store_id) store_id
    FROM wlt.partner_order_earnings e
    WHERE e.partner_actor_id=p.actor_id AND e.created_at<=p.created_at
      AND e.partner_net_minor>e.commission_receivable_offset_minor
    HAVING COUNT(DISTINCT e.store_id)=1 AND MIN(e.store_id)<>''
) source ON true
WHERE p.actor_type='partner' AND p.status<>'CANCELLED'
  AND NOT EXISTS (SELECT 1 FROM wlt.payout_store_allocations a WHERE a.payout_id=p.id)
  AND NOT EXISTS (
      SELECT 1 FROM wlt.ledger_entries l
      WHERE l.account_code='PARTNER_WALLET' AND l.actor_id=p.actor_id
        AND l.direction='CREDIT' AND l.created_at<=p.created_at
        AND NOT EXISTS (SELECT 1 FROM wlt.partner_order_earnings e WHERE e.ledger_transaction_id=l.transaction_id)
  );

CREATE FUNCTION wlt.guard_payout_store_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'committed payout allocations are immutable' USING ERRCODE = 'WLT03';
    END IF;
    IF EXISTS (
        SELECT 1 FROM wlt.store_payout_recipient_assignments a
        JOIN wlt.payout_requests p ON p.actor_id=a.partner_actor_id AND p.actor_type='partner'
        WHERE p.id=NEW.payout_id AND a.store_id=NEW.store_id AND a.state='RECIPIENT_REVIEW_REQUIRED'
    ) THEN
        RAISE EXCEPTION 'payout recipient review required for included store' USING ERRCODE = 'WLT01';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payout_store_allocations_guard
    BEFORE INSERT OR UPDATE OR DELETE ON wlt.payout_store_allocations
    FOR EACH ROW EXECUTE FUNCTION wlt.guard_payout_store_allocation();
