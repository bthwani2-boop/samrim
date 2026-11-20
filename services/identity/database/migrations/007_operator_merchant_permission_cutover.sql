-- Identity-owned, additive permission-name cutover; source-only until an
-- explicitly authorized environment upgrade. 002 and 005 remain immutable.
-- Apply after 005 (and 006 when present) under an exclusive migration writer.
-- No original Operator, grant, Store, or financial authority is provisioned.
-- All changes are transactional; conflicting dual scopes fail without mutation.
BEGIN;

LOCK TABLE __SCHEMA__.actor_roles, __SCHEMA__.operator_permissions,
    __SCHEMA__.operator_permission_commands IN SHARE ROW EXCLUSIVE MODE;

DO $cutover$
BEGIN
    IF EXISTS (
        SELECT 1 FROM __SCHEMA__.operator_permissions legacy
        JOIN __SCHEMA__.operator_permissions current
          ON current.actor_id = legacy.actor_id
        WHERE legacy.permission = 'partners' AND current.permission = 'merchant'
    ) THEN
        RAISE EXCEPTION 'conflicting historical and canonical Operator grants'
            USING ERRCODE = '23505';
    END IF;
END;
$cutover$;

-- Preserve the exact historical effective grant, state and version before
-- renaming a mutable permission key. This audit is append-only.
CREATE TABLE __SCHEMA__.operator_merchant_scope_cutover_audit (
    actor_id text PRIMARY KEY REFERENCES __SCHEMA__.actors(id),
    previous_permission text NOT NULL DEFAULT 'partners'
        CHECK (previous_permission = 'partners'),
    previous_state text NOT NULL CHECK (previous_state IN ('ACTIVE','REVOKED')),
    previous_version bigint NOT NULL CHECK (previous_version > 0),
    migrated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO __SCHEMA__.operator_merchant_scope_cutover_audit
    (actor_id, previous_state, previous_version)
SELECT actor_id, state, version
FROM __SCHEMA__.operator_permissions
WHERE permission = 'partners';

-- Replace only the current-grant constraint. Historical command/audit rows
-- remain byte-for-byte unchanged, including their original permission name.
ALTER TABLE __SCHEMA__.operator_permissions
    DROP CONSTRAINT operator_permissions_permission_check;
UPDATE __SCHEMA__.operator_permissions
   SET permission = 'merchant', version = version + 1,
       updated_at = clock_timestamp()
 WHERE permission = 'partners';
ALTER TABLE __SCHEMA__.operator_permissions
    ADD CONSTRAINT operator_permissions_permission_check CHECK (
        permission IN ('operations','merchant','catalog','marketing','finance','hr','platform_policies')
    );

-- Previously issued Operator sessions must reauthenticate and observe the
-- newly named effective scope; unrelated Customer/Merchant roles stay intact.
UPDATE __SCHEMA__.actor_roles
   SET version = version + 1, updated_at = clock_timestamp()
 WHERE role = 'operator'
   AND actor_id IN (SELECT actor_id FROM __SCHEMA__.operator_merchant_scope_cutover_audit);

-- Keep historical append-only command entries legal while admitting new
-- canonical entries. Do not permit a newly written legacy permission.
ALTER TABLE __SCHEMA__.operator_permission_commands
    DROP CONSTRAINT operator_permission_commands_permission_check;
ALTER TABLE __SCHEMA__.operator_permission_commands
    ADD CONSTRAINT operator_permission_commands_permission_check CHECK (
        permission IN ('operations','partners','merchant','catalog','marketing','finance','hr','platform_policies')
    );

CREATE FUNCTION __SCHEMA__.reject_new_legacy_operator_permission_command()
RETURNS trigger LANGUAGE plpgsql AS $cutover$
BEGIN
    IF NEW.permission = 'partners' THEN
        RAISE EXCEPTION 'historical Operator permission cannot be newly admitted'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$cutover$;
CREATE TRIGGER reject_new_legacy_operator_permission_command
    BEFORE INSERT ON __SCHEMA__.operator_permission_commands
    FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_new_legacy_operator_permission_command();

CREATE TRIGGER operator_merchant_scope_cutover_audit_immutable
    BEFORE UPDATE OR DELETE ON __SCHEMA__.operator_merchant_scope_cutover_audit
    FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.deny_operator_admin_audit_mutation();

COMMIT;
