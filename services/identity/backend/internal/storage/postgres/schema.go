package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

type schemaConstraint struct {
	table      string
	name       string
	definition string
	critical   bool
}

// identitySchemaConstraints is a release/readiness guard, not a migration
// authority. The ordered SQL migrations remain the only schema writer; this
// manifest makes destructive/manual catalog drift fail closed before it can be
// mistaken for a healthy Identity database.
var identitySchemaConstraints = []schemaConstraint{
	{table: "identity_schema_migrations", name: "identity_schema_migrations_pkey", definition: "PRIMARY KEY (version)", critical: true},
	{table: "identity_actors", name: "identity_actor_phone_check", definition: `CHECK (((phone_e164)::text ~ '^\+[1-9][0-9]{7,14}$'::text))`, critical: true},
	{table: "identity_actors", name: "identity_actor_version_check", definition: "CHECK ((version > 0))", critical: true},
	{table: "identity_actors", name: "identity_actors_pkey", definition: "PRIMARY KEY (id)", critical: true},
	{table: "identity_actor_roles", name: "identity_actor_role_activation_check", definition: "CHECK ((((role)::text = ANY ((ARRAY['partner'::character varying, 'captain'::character varying, 'field'::character varying, 'operator'::character varying, 'platform_owner'::character varying])::text[])) OR (activated_at IS NULL)))", critical: true},
	{table: "identity_actor_roles", name: "identity_actor_role_check", definition: "CHECK (((role)::text = ANY ((ARRAY['client'::character varying, 'partner'::character varying, 'captain'::character varying, 'field'::character varying, 'operator'::character varying, 'platform_owner'::character varying])::text[])))", critical: true},
	{table: "identity_actor_roles", name: "identity_actor_role_version_check", definition: "CHECK ((version > 0))", critical: true},
	{table: "identity_actor_roles", name: "identity_actor_roles_actor_id_fkey", definition: "FOREIGN KEY (actor_id) REFERENCES identity_actors(id) ON DELETE CASCADE", critical: true},
	{table: "identity_actor_roles", name: "identity_actor_roles_pkey", definition: "PRIMARY KEY (actor_id, role)", critical: true},
	{table: "identity_password_credentials", name: "identity_password_credential_role_check", definition: "CHECK (((role)::text = ANY ((ARRAY['client'::character varying, 'partner'::character varying, 'captain'::character varying, 'field'::character varying, 'operator'::character varying, 'platform_owner'::character varying])::text[])))", critical: true},
	{table: "identity_password_credentials", name: "identity_password_credential_version_check", definition: "CHECK ((version > 0))", critical: true},
	{table: "identity_password_credentials", name: "identity_password_credentials_actor_id_role_fkey", definition: "FOREIGN KEY (actor_id, role) REFERENCES identity_actor_roles(actor_id, role) ON DELETE CASCADE", critical: true},
	{table: "identity_password_credentials", name: "identity_password_credentials_pkey", definition: "PRIMARY KEY (actor_id, role)", critical: true},
	{table: "identity_challenges", name: "identity_challenge_attempts_check", definition: "CHECK (((attempts >= 0) AND (attempts <= 5)))", critical: true},
	{table: "identity_challenges", name: "identity_challenge_consumed_check", definition: "CHECK (((((status)::text = 'consumed'::text) AND (consumed_at IS NOT NULL)) OR (((status)::text <> 'consumed'::text) AND (consumed_at IS NULL))))", critical: true},
	{table: "identity_challenges", name: "identity_challenge_purpose_check", definition: "CHECK (((purpose)::text = ANY ((ARRAY['client_register'::character varying, 'client_recover'::character varying, 'managed_activate'::character varying, 'managed_recover'::character varying, 'operator_mfa'::character varying])::text[])))", critical: true},
	{table: "identity_challenges", name: "identity_challenge_purpose_role_check", definition: "CHECK (((((purpose)::text = ANY ((ARRAY['client_register'::character varying, 'client_recover'::character varying])::text[])) AND ((role)::text = 'client'::text)) OR (((purpose)::text = ANY ((ARRAY['managed_activate'::character varying, 'managed_recover'::character varying])::text[])) AND ((role)::text = ANY ((ARRAY['partner'::character varying, 'captain'::character varying, 'field'::character varying, 'operator'::character varying])::text[]))) OR (((purpose)::text = 'operator_mfa'::text) AND ((role)::text = ANY ((ARRAY['operator'::character varying, 'platform_owner'::character varying])::text[])))))", critical: true},
	{table: "identity_challenges", name: "identity_challenge_role_check", definition: "CHECK (((role)::text = ANY ((ARRAY['client'::character varying, 'partner'::character varying, 'captain'::character varying, 'field'::character varying, 'operator'::character varying, 'platform_owner'::character varying])::text[])))", critical: true},
	{table: "identity_challenges", name: "identity_challenge_status_check", definition: "CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'consumed'::character varying, 'revoked'::character varying, 'expired'::character varying, 'locked'::character varying])::text[])))", critical: true},
	{table: "identity_challenges", name: "identity_challenges_actor_id_fkey", definition: "FOREIGN KEY (actor_id) REFERENCES identity_actors(id) ON DELETE CASCADE", critical: true},
	{table: "identity_challenges", name: "identity_challenges_pkey", definition: "PRIMARY KEY (id)", critical: true},
	{table: "identity_sessions", name: "identity_session_expiry_check", definition: "CHECK ((refresh_expires_at > access_expires_at))", critical: true},
	{table: "identity_sessions", name: "identity_session_role_check", definition: "CHECK (((role)::text = ANY ((ARRAY['client'::character varying, 'partner'::character varying, 'captain'::character varying, 'field'::character varying, 'operator'::character varying, 'platform_owner'::character varying])::text[])))", critical: true},
	{table: "identity_sessions", name: "identity_session_version_check", definition: "CHECK ((version > 0))", critical: true},
	{table: "identity_sessions", name: "identity_sessions_absolute_after_refresh_check", definition: "CHECK ((absolute_expires_at > refresh_expires_at))", critical: true},
	{table: "identity_sessions", name: "identity_sessions_actor_id_role_fkey", definition: "FOREIGN KEY (actor_id, role) REFERENCES identity_actor_roles(actor_id, role) ON DELETE CASCADE", critical: true},
	{table: "identity_sessions", name: "identity_sessions_pkey", definition: "PRIMARY KEY (id)", critical: true},
	{table: "identity_refresh_token_history", name: "identity_refresh_token_history_pkey", definition: "PRIMARY KEY (session_id, token_hash)", critical: true},
	{table: "identity_refresh_token_history", name: "identity_refresh_token_history_session_id_fkey", definition: "FOREIGN KEY (session_id) REFERENCES identity_sessions(id) ON DELETE CASCADE", critical: true},
	{table: "identity_password_attempts", name: "identity_password_attempt_reserved_check", definition: "CHECK (((NOT reserved) OR (succeeded = false)))", critical: true},
	{table: "identity_password_attempts", name: "identity_password_attempt_role_check", definition: "CHECK (((role)::text = ANY ((ARRAY['client'::character varying, 'partner'::character varying, 'captain'::character varying, 'field'::character varying, 'operator'::character varying, 'platform_owner'::character varying])::text[])))", critical: true},
	{table: "identity_password_attempts", name: "identity_password_attempts_pkey", definition: "PRIMARY KEY (id)", critical: true},
	{table: "identity_security_audit", name: "identity_security_audit_pkey", definition: "PRIMARY KEY (id)", critical: true},
	{table: "identity_security_audit", name: "identity_security_audit_subject_actor_id_fkey", definition: "FOREIGN KEY (subject_actor_id) REFERENCES identity_actors(id) ON DELETE SET NULL", critical: true},
	{table: "identity_challenge_deliveries", name: "identity_challenge_deliveries_challenge_id_fkey", definition: "FOREIGN KEY (challenge_id) REFERENCES identity_challenges(id) ON DELETE CASCADE", critical: true},
	{table: "identity_challenge_deliveries", name: "identity_challenge_deliveries_pkey", definition: "PRIMARY KEY (challenge_id)", critical: true},
	{table: "identity_challenge_deliveries", name: "identity_challenge_delivery_attempts_check", definition: "CHECK (((attempts >= 0) AND (attempts <= 1)))", critical: true},
	{table: "identity_challenge_deliveries", name: "identity_challenge_delivery_provider_check", definition: "CHECK (((provider)::text <> ''::text))", critical: true},
	{table: "identity_challenge_deliveries", name: "identity_challenge_delivery_status_check", definition: "CHECK (((status)::text = ANY ((ARRAY['suppressed'::character varying, 'pending'::character varying, 'sending'::character varying, 'sent'::character varying, 'unknown'::character varying, 'expired'::character varying])::text[])))", critical: true},
	{table: "identity_managed_activation_codes", name: "identity_managed_activation_code_attempts_check", definition: "CHECK (((attempts >= 0) AND (attempts <= 5)))", critical: true},
	{table: "identity_managed_activation_codes", name: "identity_managed_activation_code_consumed_check", definition: "CHECK (((((status)::text = 'consumed'::text) AND (consumed_at IS NOT NULL)) OR (((status)::text <> 'consumed'::text) AND (consumed_at IS NULL))))", critical: true},
	{table: "identity_managed_activation_codes", name: "identity_managed_activation_code_role_check", definition: "CHECK (((role)::text = ANY ((ARRAY['partner'::character varying, 'captain'::character varying, 'field'::character varying, 'operator'::character varying])::text[])))", critical: true},
	{table: "identity_managed_activation_codes", name: "identity_managed_activation_code_status_check", definition: "CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'consumed'::character varying, 'revoked'::character varying, 'expired'::character varying, 'locked'::character varying])::text[])))", critical: true},
	{table: "identity_managed_activation_codes", name: "identity_managed_activation_codes_actor_id_role_fkey", definition: "FOREIGN KEY (actor_id, role) REFERENCES identity_actor_roles(actor_id, role) ON DELETE CASCADE", critical: true},
	{table: "identity_managed_activation_codes", name: "identity_managed_activation_codes_pkey", definition: "PRIMARY KEY (id)", critical: true},
}

func VerifyCriticalConstraints(ctx context.Context, db *sql.DB) error {
	return verifyConstraints(ctx, db, false)
}

func VerifyExactConstraints(ctx context.Context, db *sql.DB) error {
	return verifyConstraints(ctx, db, true)
}

func verifyConstraints(ctx context.Context, db *sql.DB, exact bool) error {
	rows, err := db.QueryContext(ctx, `
SELECT c.relname, con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con
JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname LIKE 'identity_%'
ORDER BY c.relname, con.conname`)
	if err != nil {
		return fmt.Errorf("schema constraint census: %w", err)
	}
	defer func() { _ = rows.Close() }()

	expected := map[string]schemaConstraint{}
	for _, constraint := range identitySchemaConstraints {
		expected[constraint.table+"/"+constraint.name] = constraint
	}
	found := map[string]bool{}
	for rows.Next() {
		var table, name, definition string
		if err := rows.Scan(&table, &name, &definition); err != nil {
			return fmt.Errorf("schema constraint scan: %w", err)
		}
		key := table + "/" + name
		constraint, ok := expected[key]
		if !ok {
			if exact {
				return fmt.Errorf("unexpected identity schema constraint: %s", key)
			}
			continue
		}
		if !exact && !constraint.critical {
			continue
		}
		found[key] = true
		if normalizeConstraintDefinition(definition) != normalizeConstraintDefinition(constraint.definition) {
			return fmt.Errorf("identity schema constraint drift at %s: got %q want %q", key, definition, constraint.definition)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("schema constraint rows: %w", err)
	}
	for _, constraint := range identitySchemaConstraints {
		if (!exact && !constraint.critical) || found[constraint.table+"/"+constraint.name] {
			continue
		}
		return fmt.Errorf("required identity schema constraint missing: %s/%s", constraint.table, constraint.name)
	}
	return nil
}

func normalizeConstraintDefinition(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(value)), " ")
}
