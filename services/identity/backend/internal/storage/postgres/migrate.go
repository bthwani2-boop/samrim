package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

const SchemaVersion = 1

type schemaRequirement struct {
	table   string
	columns []string
	indexes []string
}

var identitySchemaRequirements = []schemaRequirement{
	{
		table:   "identity_schema_migrations",
		columns: []string{"version", "applied_at"},
		indexes: []string{"identity_schema_migrations_pkey"},
	},
	{
		table: "identity_actors",
		columns: []string{
			"id", "phone_e164", "username", "password_hash", "security_enabled",
			"version", "created_at", "updated_at",
		},
		indexes: []string{"identity_actors_pkey", "identity_actors_phone_uq", "identity_actors_username_uq"},
	},
	{
		table:   "identity_actor_roles",
		columns: []string{"actor_id", "role", "enabled", "version", "created_at", "updated_at"},
		indexes: []string{"identity_actor_roles_pkey", "identity_actor_roles_role_idx"},
	},
	{
		table: "identity_activation_challenges",
		columns: []string{
			"id", "actor_id", "role", "phone_e164", "code_hash", "request_ip_hash",
			"status", "attempts", "expires_at", "consumed_at", "created_at", "updated_at",
		},
		indexes: []string{
			"identity_activation_challenges_pkey",
			"identity_activation_one_pending_uq",
			"identity_activation_lookup_idx",
			"identity_activation_ip_idx",
		},
	},
	{
		table: "identity_sessions",
		columns: []string{
			"id", "actor_id", "role", "access_token_hash", "refresh_token_hash",
			"device_fingerprint_hash", "access_expires_at", "refresh_expires_at",
			"revoked_at", "compromised_at", "last_used_at", "version", "created_at",
		},
		indexes: []string{
			"identity_sessions_pkey",
			"identity_sessions_access_hash_uq",
			"identity_sessions_refresh_hash_uq",
			"identity_sessions_actor_role_idx",
			"identity_sessions_active_idx",
		},
	},
	{
		table:   "identity_refresh_token_history",
		columns: []string{"session_id", "token_hash", "rotated_at"},
		indexes: []string{
			"identity_refresh_token_history_pkey",
			"identity_refresh_token_history_hash_uq",
			"identity_refresh_token_history_session_idx",
		},
	},
	{
		table:   "identity_login_attempts",
		columns: []string{"id", "username", "ip_hash", "succeeded", "created_at"},
		indexes: []string{
			"identity_login_attempts_pkey",
			"identity_login_attempts_username_idx",
			"identity_login_attempts_ip_idx",
		},
	},
	{
		table: "identity_security_audit",
		columns: []string{
			"id", "event_type", "subject_actor_id", "principal", "outcome",
			"correlation_id", "metadata", "created_at",
		},
		indexes: []string{"identity_security_audit_pkey", "identity_security_audit_subject_idx"},
	},
}

func Migrate(ctx context.Context, db *sql.DB, migrationSQL string) error {
	if migrationSQL == "" {
		return fmt.Errorf("identity migration is empty")
	}
	if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
		return fmt.Errorf("apply identity canonical migration v1: %w", err)
	}
	return nil
}

func Ready(ctx context.Context, db *sql.DB) error {
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("database ping: %w", err)
	}
	var version int
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0) FROM identity_schema_migrations").Scan(&version); err != nil {
		return fmt.Errorf("migration readback: %w", err)
	}
	if version != SchemaVersion {
		return fmt.Errorf("migration version mismatch: got %d want %d", version, SchemaVersion)
	}

	for _, requirement := range identitySchemaRequirements {
		var resolved sql.NullString
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1)", requirement.table).Scan(&resolved); err != nil {
			return fmt.Errorf("relation check %s: %w", requirement.table, err)
		}
		if !resolved.Valid || resolved.String == "" {
			return fmt.Errorf("required relation missing: %s", requirement.table)
		}
		if err := requireColumns(ctx, db, requirement); err != nil {
			return err
		}
		if err := requireIndexes(ctx, db, requirement); err != nil {
			return err
		}
	}

	for _, legacyColumn := range []string{
		"operator_context_id", "roles", "permissions", "status", "provisioning_fingerprint", "created_by_service",
	} {
		var exists bool
		if err := db.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='identity_actors' AND column_name=$1)",
			legacyColumn).Scan(&exists); err != nil {
			return fmt.Errorf("legacy schema check %s: %w", legacyColumn, err)
		}
		if exists {
			return fmt.Errorf("legacy identity actor column remains: %s", legacyColumn)
		}
	}
	var databaseNow time.Time
	if err := db.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&databaseNow); err != nil {
		return fmt.Errorf("database clock: %w", err)
	}
	drift := time.Since(databaseNow)
	if drift < 0 {
		drift = -drift
	}
	if drift > 30*time.Second {
		return fmt.Errorf("database clock drift exceeds 30s: %s", drift)
	}
	return nil
}

func requireColumns(ctx context.Context, db *sql.DB, requirement schemaRequirement) error {
	rows, err := db.QueryContext(ctx,
		"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
		requirement.table)
	if err != nil {
		return fmt.Errorf("schema column census %s: %w", requirement.table, err)
	}
	found := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			_ = rows.Close()
			return fmt.Errorf("schema column scan %s: %w", requirement.table, err)
		}
		found[name] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("schema column rows %s: %w", requirement.table, err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("schema column close %s: %w", requirement.table, err)
	}
	for _, column := range requirement.columns {
		if !found[column] {
			return fmt.Errorf("required column missing: %s.%s", requirement.table, column)
		}
	}
	return nil
}

func requireIndexes(ctx context.Context, db *sql.DB, requirement schemaRequirement) error {
	rows, err := db.QueryContext(ctx,
		"SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1",
		requirement.table)
	if err != nil {
		return fmt.Errorf("schema index census %s: %w", requirement.table, err)
	}
	found := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			_ = rows.Close()
			return fmt.Errorf("schema index scan %s: %w", requirement.table, err)
		}
		found[name] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("schema index rows %s: %w", requirement.table, err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("schema index close %s: %w", requirement.table, err)
	}
	for _, index := range requirement.indexes {
		if !found[index] {
			return fmt.Errorf("required index missing: %s", index)
		}
	}
	return nil
}
