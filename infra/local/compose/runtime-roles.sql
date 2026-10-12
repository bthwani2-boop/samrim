-- LOCAL DEVELOPMENT ONLY. Applied after the three canonical migration one-shots.
-- Never migrate or transfer ownership with these runtime credentials.
\set ON_ERROR_STOP on
BEGIN;
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT', 'samrim_identity_runtime') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='samrim_identity_runtime')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L', 'samrim_identity_runtime', :'identity_pwd')
\gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT', 'samrim_identity_maintenance') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='samrim_identity_maintenance')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L', 'samrim_identity_maintenance', :'maintenance_pwd')
\gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT', 'samrim_dsh_runtime') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='samrim_dsh_runtime')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L', 'samrim_dsh_runtime', :'dsh_pwd')
\gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT', 'samrim_wlt_runtime') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='samrim_wlt_runtime')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD %L', 'samrim_wlt_runtime', :'wlt_pwd')
\gexec

-- Database and schema names are canonical; never give runtime roles DDL rights.
GRANT CONNECT ON DATABASE :"db_name" TO samrim_identity_runtime, samrim_identity_maintenance, samrim_dsh_runtime, samrim_wlt_runtime;
GRANT USAGE ON SCHEMA public TO samrim_identity_runtime, samrim_identity_maintenance, samrim_dsh_runtime, samrim_wlt_runtime;
GRANT USAGE ON SCHEMA dsh TO samrim_dsh_runtime;
-- WLT reconciles posted financial handoffs using read-only commerce projections.
-- Do not grant WLT general DSH table, write, or DDL access.
GRANT USAGE ON SCHEMA dsh TO samrim_wlt_runtime;
GRANT USAGE ON SCHEMA wlt TO samrim_wlt_runtime;

-- Explicit Identity table privileges mirror identityRuntimePrivileges and identityMaintenancePrivileges.
GRANT SELECT ON TABLE public.identity_actors, public.identity_actor_roles, public.identity_password_credentials, public.identity_challenges, public.identity_challenge_deliveries, public.identity_operator_enrollment_tokens, public.identity_sessions, public.identity_refresh_token_history, public.identity_password_attempts, public.identity_security_audit, public.identity_schema_migrations, public.identity_bootstrap_state, public.identity_webauthn_users, public.identity_webauthn_credentials, public.identity_webauthn_ceremonies, public.identity_operator_recovery_credentials, public.identity_operator_permissions, public.identity_actor_legal_name_versions, public.identity_actor_legal_names, public.identity_actor_legal_name_events, public.identity_operator_profiles, public.identity_operator_profile_events TO samrim_identity_runtime;
GRANT INSERT ON TABLE public.identity_actors, public.identity_actor_roles, public.identity_password_credentials, public.identity_challenges, public.identity_challenge_deliveries, public.identity_operator_enrollment_tokens, public.identity_sessions, public.identity_refresh_token_history, public.identity_password_attempts, public.identity_security_audit, public.identity_bootstrap_state, public.identity_webauthn_users, public.identity_webauthn_credentials, public.identity_webauthn_ceremonies, public.identity_operator_recovery_credentials, public.identity_operator_permissions, public.identity_actor_legal_name_versions, public.identity_actor_legal_names, public.identity_actor_legal_name_events, public.identity_operator_profiles, public.identity_operator_profile_events TO samrim_identity_runtime;
GRANT UPDATE ON TABLE public.identity_actors, public.identity_actor_roles, public.identity_password_credentials, public.identity_challenges, public.identity_challenge_deliveries, public.identity_operator_enrollment_tokens, public.identity_sessions, public.identity_password_attempts, public.identity_webauthn_users, public.identity_webauthn_credentials, public.identity_webauthn_ceremonies, public.identity_operator_recovery_credentials, public.identity_operator_permissions, public.identity_actor_legal_name_versions, public.identity_actor_legal_names, public.identity_operator_profiles TO samrim_identity_runtime;
GRANT DELETE ON TABLE public.identity_password_attempts TO samrim_identity_runtime;
GRANT SELECT, DELETE ON TABLE public.identity_challenge_deliveries, public.identity_challenges, public.identity_operator_enrollment_tokens, public.identity_password_attempts, public.identity_refresh_token_history, public.identity_sessions, public.identity_security_audit, public.identity_webauthn_ceremonies, public.identity_operator_recovery_credentials TO samrim_identity_maintenance;
-- Only owned sequences: no privilege on PostGIS or unrelated public objects.
DO $grant_identity_sequences$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT quote_ident(sequence_schema)||'.'||quote_ident(sequence_name) AS qualified
    FROM information_schema.sequences
    WHERE sequence_schema='public' AND left(sequence_name, 9)='identity_'
  LOOP
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE '||obj.qualified||' TO samrim_identity_runtime';
  END LOOP;
END
$grant_identity_sequences$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dsh TO samrim_dsh_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA dsh TO samrim_dsh_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA dsh GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO samrim_dsh_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA dsh GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO samrim_dsh_runtime;

GRANT SELECT ON TABLE dsh.commerce_financial_handoff_outbox, dsh.commerce_orders TO samrim_wlt_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wlt TO samrim_wlt_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA wlt TO samrim_wlt_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA wlt GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO samrim_wlt_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA wlt GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO samrim_wlt_runtime;

-- Fail closed if a runtime role acquires cross-owner, DDL or sensitive Identity privileges.
DO $assert_runtime_boundaries$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['samrim_identity_runtime','samrim_identity_maintenance','samrim_dsh_runtime','samrim_wlt_runtime'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication))
      OR has_database_privilege(role_name,current_database(),'CREATE')
      OR has_schema_privilege(role_name,'public','CREATE')
      OR has_schema_privilege(role_name,'dsh','CREATE')
      OR has_schema_privilege(role_name,'wlt','CREATE') THEN
      RAISE EXCEPTION 'unsafe database authority for %',role_name;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('samrim_identity_runtime','public.identity_actors','SELECT,INSERT,UPDATE')
    OR has_table_privilege('samrim_identity_runtime','public.identity_security_audit','UPDATE')
    OR has_table_privilege('samrim_identity_runtime','public.identity_security_audit','DELETE')
    OR has_table_privilege('samrim_identity_runtime','public.identity_schema_migrations','INSERT')
    OR NOT has_table_privilege('samrim_identity_maintenance','public.identity_security_audit','DELETE')
    OR has_table_privilege('samrim_identity_maintenance','public.identity_security_audit','INSERT')
    OR NOT has_table_privilege('samrim_dsh_runtime','dsh.stores','SELECT,INSERT,UPDATE,DELETE')
    OR NOT has_table_privilege('samrim_wlt_runtime','wlt.payment_intents','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('samrim_dsh_runtime','wlt.payment_intents','SELECT')
    OR NOT has_table_privilege('samrim_wlt_runtime','dsh.commerce_financial_handoff_outbox','SELECT')
    OR NOT has_table_privilege('samrim_wlt_runtime','dsh.commerce_orders','SELECT')
    OR has_table_privilege('samrim_wlt_runtime','dsh.commerce_financial_handoff_outbox','INSERT,UPDATE,DELETE')
    OR has_table_privilege('samrim_wlt_runtime','dsh.commerce_orders','INSERT,UPDATE,DELETE')
    OR has_table_privilege('samrim_wlt_runtime','dsh.stores','SELECT')
    OR has_table_privilege('samrim_identity_runtime','dsh.stores','SELECT')
    OR has_table_privilege('samrim_identity_runtime','wlt.payment_intents','SELECT')
    THEN RAISE EXCEPTION 'database runtime privileges violate service ownership';
  END IF;
END
$assert_runtime_boundaries$;

COMMIT;
