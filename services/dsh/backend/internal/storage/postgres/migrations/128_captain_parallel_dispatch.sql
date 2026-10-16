-- Allow one order to offer work to up to three BTHWANI_CAPTAINs in one
-- application-owned transaction. PARTNER_CAPTAIN remains single-offer.
DROP INDEX dsh.captain_dispatch_offers_order_active_uq;
CREATE INDEX captain_dispatch_offers_order_active_idx
    ON dsh.captain_dispatch_offers(order_id,created_at DESC) WHERE state='offered';

-- A distinct audit event is required when a winner supersedes other offers.
ALTER TABLE dsh.captain_audit DROP CONSTRAINT captain_audit_event_type_chk;
ALTER TABLE dsh.captain_audit ADD CONSTRAINT captain_audit_event_type_chk CHECK (event_type IN (
    'dispatch_offer_created','dispatch_offer_accepted','dispatch_offer_rejected',
    'dispatch_offer_expired','dispatch_offer_superseded','captain_offer_superseded_by_access',
    'captain_assignment_reassigned','store_handoff_confirmed','captain_pickup_completed',
    'delivery_completed','delivery_failed','delivery_recovered'
));
