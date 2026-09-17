-- Captain access transitions and unattended offer expiry are DSH-owned.
ALTER TABLE dsh.captain_admissions
    ADD CONSTRAINT captain_admissions_suspended_availability_chk
    CHECK (state <> 'suspended' OR availability_state = 'unavailable');

ALTER TABLE dsh.captain_audit
    DROP CONSTRAINT captain_audit_event_type_chk;

ALTER TABLE dsh.captain_audit
    ADD CONSTRAINT captain_audit_event_type_chk
    CHECK (event_type IN (
        'dispatch_offer_created',
        'dispatch_offer_accepted',
        'dispatch_offer_rejected',
        'dispatch_offer_expired',
        'captain_offer_superseded_by_access',
        'captain_assignment_reassigned',
        'store_handoff_confirmed',
        'captain_pickup_completed',
        'delivery_completed'
    ));
