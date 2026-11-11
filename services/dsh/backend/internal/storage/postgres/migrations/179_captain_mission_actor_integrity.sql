-- Preserve one latest GPS fix per assignment, but make its attributed Captain
-- match the canonical assignment owner at the database boundary as well as Go.
-- Existing mismatched rows fail validation; this migration never rewrites them.
ALTER TABLE dsh.captain_assignments
    ADD CONSTRAINT captain_assignments_id_actor_uq UNIQUE (id, captain_actor_id);

ALTER TABLE dsh.captain_mission_latest
    ADD CONSTRAINT captain_mission_latest_assignment_actor_fk
    FOREIGN KEY (assignment_id, captain_actor_id)
    REFERENCES dsh.captain_assignments(id, captain_actor_id)
    ON DELETE CASCADE;

-- The composite FK covers assignment existence and cascading deletion; retain
-- no redundant single-column foreign key for the same GPS row.
ALTER TABLE dsh.captain_mission_latest
    DROP CONSTRAINT captain_mission_latest_assignment_id_fkey;
