-- A delivery failure preserves physical custody until an explicit DSH-owned
-- recovery transition.  The recovery operation is idempotent and never
-- reassigns the custody-bearing assignment.
ALTER TABLE dsh.captain_operation_idempotency
    DROP CONSTRAINT captain_operation_idempotency_operation_chk;

ALTER TABLE dsh.captain_operation_idempotency
    ADD CONSTRAINT captain_operation_idempotency_operation_chk
    CHECK (operation IN ('availability', 'dispatch', 'respond_offer', 'reassign', 'store_confirm', 'pickup', 'complete', 'recover'));

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
        'delivery_completed',
        'delivery_failed',
        'delivery_recovered'
    ));

-- Migration 018 removed the dead termination state, but the pre-recovery
-- implementation could have released a failed-custody Captain. Reconcile
-- that durable contradiction once, with attributable audit evidence.
DO $$
DECLARE
    reconciled RECORD;
BEGIN
    FOR reconciled IN
        UPDATE dsh.captain_admissions admission
        SET availability_state = 'unavailable',
            version = version + 1,
            updated_at = clock_timestamp()
        WHERE admission.state = 'eligible'
          AND admission.availability_state = 'available'
          AND EXISTS (
              SELECT 1
              FROM dsh.captain_assignments assignment
              WHERE assignment.captain_actor_id = admission.actor_id
                AND assignment.state = 'delivery_failed'
          )
        RETURNING admission.id, admission.actor_id, admission.version
    LOOP
        INSERT INTO dsh.captain_admission_audit(
            event_type, idempotency_key, correlation_id, acting_actor_id,
            admission_id, actor_id, from_state, to_state, from_version,
            result_version, request_hash
        ) VALUES (
            'captain_availability_changed',
            'migration-019-custody-reconcile:' || reconciled.actor_id,
            'migration-019-custody-reconcile',
            'migration-019',
            reconciled.id,
            reconciled.actor_id,
            'available',
            'unavailable',
            reconciled.version - 1,
            reconciled.version,
            'migration-019-custody-reconcile'
        );
    END LOOP;
END $$;
