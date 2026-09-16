-- Governance does not define a Captain termination transition or operational
-- meaning. Remove the unreachable state without rewriting existing history.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM dsh.captain_admissions WHERE state = 'terminated')
        OR EXISTS (SELECT 1 FROM dsh.captain_admission_idempotency WHERE result_state = 'terminated')
        OR EXISTS (SELECT 1 FROM dsh.captain_admission_audit WHERE from_state = 'terminated' OR to_state = 'terminated') THEN
        RAISE EXCEPTION 'cannot remove captain terminated state while terminated records exist';
    END IF;
END $$;

ALTER TABLE dsh.captain_admissions
    DROP CONSTRAINT captain_admissions_state_chk;

ALTER TABLE dsh.captain_admissions
    ADD CONSTRAINT captain_admissions_state_chk
    CHECK (state IN ('pending_identity', 'eligible', 'suspended'));

ALTER TABLE dsh.captain_admission_idempotency
    DROP CONSTRAINT captain_admission_idempotency_state_chk;

ALTER TABLE dsh.captain_admission_idempotency
    ADD CONSTRAINT captain_admission_idempotency_state_chk
    CHECK (result_state IN ('pending_identity', 'eligible', 'suspended'));
