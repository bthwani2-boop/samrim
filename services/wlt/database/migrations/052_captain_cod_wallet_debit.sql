-- New COD: the Captain retains customer cash and WLT settles the collection
-- against the Captain's wallet in one atomic, balanced ledger transaction.
-- Preserve FINALIZED/REMITTED records from the legacy remittance lifecycle;
-- they must not be silently debited a second time.
ALTER TABLE wlt.captain_cod_reservations
  DROP CONSTRAINT captain_cod_reservations_state_chk,
  DROP CONSTRAINT captain_cod_reservations_terminal_time_chk;

ALTER TABLE wlt.captain_cod_reservations
  ADD CONSTRAINT captain_cod_reservations_state_chk
    CHECK (state IN ('ACTIVE','RELEASED','FINALIZED','REMITTED','DEBITED')),
  ADD CONSTRAINT captain_cod_reservations_terminal_time_chk CHECK (
    (state='ACTIVE' AND released_at IS NULL AND finalized_at IS NULL AND remitted_at IS NULL)
    OR (state='RELEASED' AND released_at IS NOT NULL AND finalized_at IS NULL AND remitted_at IS NULL)
    OR (state='FINALIZED' AND released_at IS NULL AND finalized_at IS NOT NULL AND remitted_at IS NULL)
    OR (state='REMITTED' AND released_at IS NULL AND finalized_at IS NOT NULL AND remitted_at IS NOT NULL)
    OR (state='DEBITED' AND released_at IS NULL AND finalized_at IS NOT NULL AND remitted_at IS NULL)
  );

ALTER TABLE wlt.captain_cod_reservation_events
  DROP CONSTRAINT captain_cod_reservation_events_type_chk,
  ADD CONSTRAINT captain_cod_reservation_events_type_chk CHECK (event_type IN (
    'CAPTAIN_COD_RESERVED', 'CAPTAIN_COD_RELEASED', 'CAPTAIN_COD_FINALIZED',
    'CAPTAIN_COD_REMITTED', 'CAPTAIN_COD_REMITTANCE_REOPENED',
    'CAPTAIN_COD_DEBITED'
  ));
