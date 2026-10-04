ALTER TABLE wlt.store_commercial_agreements
    ADD COLUMN finance_decision_by_actor_id text,
    ADD COLUMN finance_decision_at timestamptz;

DROP TRIGGER store_commercial_agreements_lifecycle_guard ON wlt.store_commercial_agreements;

-- Preserve the exact Finance actor, time, and reason for decisions already
-- represented by the agreement lifecycle/event ledger before enforcing the
-- read-back contract on every decided agreement.
UPDATE wlt.store_commercial_agreements AS agreement
SET finance_decision_by_actor_id = COALESCE(
        agreement.finance_approved_by_actor_id,
        (SELECT event.actor_id
         FROM wlt.store_commercial_agreement_events AS event
         WHERE event.agreement_id = agreement.agreement_id
           AND event.event_type = CASE WHEN agreement.status = 'FINANCE_REJECTED' THEN 'FINANCE_REJECTED' ELSE 'FINANCE_APPROVED' END
         ORDER BY event.created_at DESC, event.id DESC
         LIMIT 1)
    ),
    finance_decision_at = COALESCE(
        agreement.finance_approved_at,
        (SELECT event.created_at
         FROM wlt.store_commercial_agreement_events AS event
         WHERE event.agreement_id = agreement.agreement_id
           AND event.event_type = CASE WHEN agreement.status = 'FINANCE_REJECTED' THEN 'FINANCE_REJECTED' ELSE 'FINANCE_APPROVED' END
         ORDER BY event.created_at DESC, event.id DESC
         LIMIT 1)
    ),
    finance_decision_reason = COALESCE(
        agreement.finance_decision_reason,
        (SELECT event.reason
         FROM wlt.store_commercial_agreement_events AS event
         WHERE event.agreement_id = agreement.agreement_id
           AND event.event_type = CASE WHEN agreement.status = 'FINANCE_REJECTED' THEN 'FINANCE_REJECTED' ELSE 'FINANCE_APPROVED' END
         ORDER BY event.created_at DESC, event.id DESC
         LIMIT 1)
    )
WHERE agreement.status IN ('ACTIVE', 'SUPERSEDED', 'FINANCE_REJECTED');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM wlt.store_commercial_agreements
        WHERE status IN ('ACTIVE', 'SUPERSEDED', 'FINANCE_REJECTED')
          AND (finance_decision_by_actor_id IS NULL OR finance_decision_at IS NULL OR finance_decision_reason IS NULL)
    ) THEN
        RAISE EXCEPTION 'cannot backfill canonical Finance decision facts for every decided Store agreement';
    END IF;
END;
$$;

ALTER TABLE wlt.store_commercial_agreements
    ADD CONSTRAINT store_commercial_agreements_finance_decision_chk CHECK (
        (status IN ('PROPOSED', 'PARTNER_ACCEPTED') AND finance_decision_by_actor_id IS NULL AND finance_decision_at IS NULL AND finance_decision_reason IS NULL) OR
        (status IN ('ACTIVE', 'SUPERSEDED', 'FINANCE_REJECTED') AND
         length(btrim(finance_decision_by_actor_id)) BETWEEN 1 AND 128 AND finance_decision_at IS NOT NULL AND
         length(btrim(finance_decision_reason)) BETWEEN 1 AND 500)
    );

CREATE OR REPLACE FUNCTION wlt.guard_store_commercial_agreement_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.store_id <> NEW.store_id OR OLD.partner_actor_id <> NEW.partner_actor_id OR
       OLD.agreement_version <> NEW.agreement_version OR OLD.proposed_by_actor_id <> NEW.proposed_by_actor_id OR
       OLD.proposed_at <> NEW.proposed_at OR OLD.reason <> NEW.reason OR
       OLD.idempotency_key <> NEW.idempotency_key OR OLD.request_hash <> NEW.request_hash OR
       OLD.correlation_id <> NEW.correlation_id THEN
        RAISE EXCEPTION 'store commercial agreement proposal facts are immutable';
    END IF;
    IF OLD.finance_decision_by_actor_id IS NOT NULL AND
       (OLD.finance_decision_by_actor_id IS DISTINCT FROM NEW.finance_decision_by_actor_id OR
        OLD.finance_decision_at IS DISTINCT FROM NEW.finance_decision_at OR
        OLD.finance_decision_reason IS DISTINCT FROM NEW.finance_decision_reason) THEN
        RAISE EXCEPTION 'store commercial agreement Finance decision facts are immutable';
    END IF;
    IF OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED' AND
       OLD.partner_accepted_by_actor_id = NEW.partner_accepted_by_actor_id AND
       OLD.partner_accepted_at = NEW.partner_accepted_at AND
       OLD.finance_approved_by_actor_id = NEW.finance_approved_by_actor_id AND
       OLD.finance_approved_at = NEW.finance_approved_at AND OLD.effective_at = NEW.effective_at AND
       OLD.finance_decision_by_actor_id = NEW.finance_decision_by_actor_id AND
       OLD.finance_decision_at = NEW.finance_decision_at AND
       OLD.finance_decision_reason = NEW.finance_decision_reason AND NEW.superseded_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'PROPOSED' AND NEW.status = 'PARTNER_ACCEPTED' AND
       NEW.partner_accepted_by_actor_id IS NOT NULL AND NEW.partner_accepted_at IS NOT NULL AND
       NEW.finance_approved_at IS NULL AND NEW.effective_at IS NULL AND NEW.superseded_at IS NULL AND
       NEW.finance_decision_by_actor_id IS NULL AND NEW.finance_decision_at IS NULL AND NEW.finance_decision_reason IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'PARTNER_ACCEPTED' AND NEW.status IN ('ACTIVE','FINANCE_REJECTED') AND
       OLD.partner_accepted_by_actor_id = NEW.partner_accepted_by_actor_id AND
       OLD.partner_accepted_at = NEW.partner_accepted_at AND OLD.superseded_at IS NULL AND
       OLD.finance_decision_by_actor_id IS NULL AND OLD.finance_decision_at IS NULL AND OLD.finance_decision_reason IS NULL AND
       NEW.finance_decision_by_actor_id IS NOT NULL AND NEW.finance_decision_at IS NOT NULL AND
       NEW.finance_decision_reason IS NOT NULL AND
       ((NEW.status = 'ACTIVE' AND NEW.finance_approved_by_actor_id = NEW.finance_decision_by_actor_id AND
         NEW.finance_approved_at = NEW.finance_decision_at AND NEW.effective_at IS NOT NULL) OR
        (NEW.status = 'FINANCE_REJECTED' AND NEW.finance_approved_by_actor_id IS NULL AND
         NEW.finance_approved_at IS NULL AND NEW.effective_at IS NULL)) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid store commercial agreement lifecycle transition';
END;
$$;

CREATE TRIGGER store_commercial_agreements_lifecycle_guard
    BEFORE UPDATE ON wlt.store_commercial_agreements
    FOR EACH ROW EXECUTE FUNCTION wlt.guard_store_commercial_agreement_mutation();
