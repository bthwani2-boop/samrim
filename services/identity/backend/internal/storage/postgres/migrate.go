package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

const SchemaVersion = 13

type MigrationRecord struct {
	Version int
	Name    string
	SHA256  string
}

type schemaRequirement struct {
	table   string
	columns []string
	indexes []string
}

var identitySchemaRequirements = []schemaRequirement{
	{table: "identity_schema_migrations", columns: []string{"version", "name", "sha256", "applied_at"}, indexes: []string{"identity_schema_migrations_pkey"}},
	{table: "identity_actors", columns: []string{"id", "phone_e164", "security_enabled", "version", "created_at", "updated_at"}, indexes: []string{"identity_actors_pkey", "identity_actors_phone_uq"}},
	{table: "identity_actor_roles", columns: []string{"actor_id", "role", "enabled", "activated_at", "version", "created_at", "updated_at"}, indexes: []string{"identity_actor_roles_pkey", "identity_actor_roles_role_idx", "identity_actor_roles_platform_owner_uq"}},
	{table: "identity_password_credentials", columns: []string{"actor_id", "role", "password_hash", "version", "created_at", "updated_at"}, indexes: []string{"identity_password_credentials_pkey"}},
	{table: "identity_challenges", columns: []string{"id", "actor_id", "role", "purpose", "phone_e164", "code_hash", "request_ip_hash", "admissible", "credential_version", "status", "attempts", "expires_at", "consumed_at", "created_at", "updated_at"}, indexes: []string{"identity_challenges_pkey", "identity_challenges_one_pending_uq", "identity_challenges_lookup_idx", "identity_challenges_ip_idx", "identity_challenges_phone_purpose_idx"}},
	{table: "identity_challenge_deliveries", columns: []string{"challenge_id", "provider", "status", "attempts", "started_at", "finished_at", "created_at", "updated_at"}, indexes: []string{"identity_challenge_deliveries_pkey", "identity_challenge_deliveries_pending_idx"}},
	{table: "identity_managed_activation_codes", columns: []string{"id", "actor_id", "role", "phone_e164", "code_hash", "status", "attempts", "expires_at", "consumed_at", "created_by", "created_at", "updated_at"}, indexes: []string{"identity_managed_activation_codes_pkey", "identity_managed_activation_codes_pending_uq", "identity_managed_activation_codes_lookup_idx"}},
	{table: "identity_sessions", columns: []string{"id", "actor_id", "role", "access_token_hash", "refresh_token_hash", "device_fingerprint_hash", "access_expires_at", "refresh_expires_at", "absolute_expires_at", "revoked_at", "compromised_at", "last_used_at", "version", "created_at"}, indexes: []string{"identity_sessions_pkey", "identity_sessions_access_hash_uq", "identity_sessions_refresh_hash_uq", "identity_sessions_actor_role_idx", "identity_sessions_active_idx", "identity_sessions_absolute_idx"}},
	{table: "identity_refresh_token_history", columns: []string{"session_id", "token_hash", "rotated_at"}, indexes: []string{"identity_refresh_token_history_pkey", "identity_refresh_token_history_hash_uq", "identity_refresh_token_history_session_idx"}},
	{table: "identity_password_attempts", columns: []string{"id", "phone_e164", "role", "ip_hash", "succeeded", "reserved", "created_at"}, indexes: []string{"identity_password_attempts_pkey", "identity_password_attempts_subject_idx", "identity_password_attempts_ip_idx"}},
	{table: "identity_security_audit", columns: []string{"id", "event_type", "subject_actor_id", "principal", "outcome", "correlation_id", "metadata", "created_at"}, indexes: []string{"identity_security_audit_pkey", "identity_security_audit_subject_idx"}},
}

func CurrentSchemaVersion(ctx context.Context, db *sql.DB) (int, error) {
	var relation sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('public.identity_schema_migrations')").Scan(&relation); err != nil {
		return 0, fmt.Errorf("migration authority lookup: %w", err)
	}
	if !relation.Valid || relation.String == "" {
		return 0, nil
	}
	rows, err := db.QueryContext(ctx, "SELECT version FROM identity_schema_migrations ORDER BY version")
	if err != nil {
		return 0, fmt.Errorf("migration history readback: %w", err)
	}
	defer func() { _ = rows.Close() }()
	expected := 1
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return 0, fmt.Errorf("migration history scan: %w", err)
		}
		if version != expected {
			return 0, fmt.Errorf("migration history is non-contiguous: got %d want %d", version, expected)
		}
		expected++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("migration history rows: %w", err)
	}
	return expected - 1, nil
}

func Migrate(ctx context.Context, db *sql.DB, version int, name, sha256, migrationSQL string) error {
	if migrationSQL == "" {
		return fmt.Errorf("identity migration v%d is empty", version)
	}
	current, err := CurrentSchemaVersion(ctx, db)
	if err != nil {
		return err
	}
	if current >= version {
		return nil
	}
	if current != version-1 {
		return fmt.Errorf("identity migration v%d cannot follow schema v%d", version, current)
	}
	if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
		return fmt.Errorf("apply identity canonical migration v%d: %w", version, err)
	}
	if version >= 12 {
		if _, err := db.ExecContext(ctx, "INSERT INTO identity_schema_migrations(version,name,sha256) VALUES($1,$2,$3) ON CONFLICT (version) DO NOTHING", version, name, sha256); err != nil {
			return fmt.Errorf("record identity canonical migration v%d: %w", version, err)
		}
	}
	applied, err := CurrentSchemaVersion(ctx, db)
	if err != nil {
		return err
	}
	if applied != version {
		return fmt.Errorf("identity migration v%d did not record canonical version; got %d", version, applied)
	}
	return nil
}

func SynchronizeMigrationHistory(ctx context.Context, db *sql.DB, records []MigrationRecord) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("migration history verification transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM identity_schema_migrations").Scan(&count); err != nil {
		return fmt.Errorf("migration history count: %w", err)
	}
	if count != len(records) {
		return fmt.Errorf("migration history count mismatch: got %d want %d", count, len(records))
	}
	for _, record := range records {
		var name, sha256 string
		err := tx.QueryRowContext(ctx, "SELECT name,sha256 FROM identity_schema_migrations WHERE version=$1", record.Version).Scan(&name, &sha256)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("migration history missing version %d", record.Version)
		}
		if err != nil {
			return fmt.Errorf("migration history read version %d: %w", record.Version, err)
		}
		if name == "" && sha256 == "" {
			if _, err := tx.ExecContext(ctx, "UPDATE identity_schema_migrations SET name=$2,sha256=$3 WHERE version=$1", record.Version, record.Name, record.SHA256); err != nil {
				return fmt.Errorf("migration history backfill version %d: %w", record.Version, err)
			}
			continue
		}
		if name != record.Name || sha256 != record.SHA256 {
			return fmt.Errorf("migration history checksum mismatch at v%d: name=%q sha256=%q", record.Version, name, sha256)
		}
	}
	if _, err := tx.ExecContext(ctx, "ALTER TABLE identity_schema_migrations ALTER COLUMN name SET NOT NULL, ALTER COLUMN sha256 SET NOT NULL"); err != nil {
		return fmt.Errorf("migration history constraints: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("migration history verification commit: %w", err)
	}
	return nil
}

func VerifyMigrationHistory(ctx context.Context, db *sql.DB, records []MigrationRecord) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return fmt.Errorf("migration history read-only transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM identity_schema_migrations").Scan(&count); err != nil {
		return fmt.Errorf("migration history count: %w", err)
	}
	if count != len(records) {
		return fmt.Errorf("migration history count mismatch: got %d want %d", count, len(records))
	}
	for _, record := range records {
		var name, sha256 sql.NullString
		err := tx.QueryRowContext(ctx, "SELECT name,sha256 FROM identity_schema_migrations WHERE version=$1", record.Version).Scan(&name, &sha256)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("migration history missing version %d", record.Version)
		}
		if err != nil {
			return fmt.Errorf("migration history read version %d: %w", record.Version, err)
		}
		if !name.Valid || !sha256.Valid || name.String != record.Name || sha256.String != record.SHA256 {
			return fmt.Errorf("migration history checksum mismatch at v%d", record.Version)
		}
	}
	return nil
}

func Ready(ctx context.Context, db *sql.DB) error {
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("database ping: %w", err)
	}
	version, err := CurrentSchemaVersion(ctx, db)
	if err != nil {
		return err
	}
	if version != SchemaVersion {
		return fmt.Errorf("migration version mismatch: got %d want %d", version, SchemaVersion)
	}
	for _, req := range identitySchemaRequirements {
		var resolved sql.NullString
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1)", req.table).Scan(&resolved); err != nil {
			return fmt.Errorf("relation check %s: %w", req.table, err)
		}
		if !resolved.Valid || resolved.String == "" {
			return fmt.Errorf("required relation missing: %s", req.table)
		}
		if err := requireColumns(ctx, db, req); err != nil {
			return err
		}
		if err := requireIndexes(ctx, db, req); err != nil {
			return err
		}
	}
	for _, legacy := range []struct{ table, column string }{
		{"identity_actors", "username"}, {"identity_actors", "password_hash"}, {"identity_actors", "operator_context_id"}, {"identity_actors", "roles"}, {"identity_actors", "permissions"}, {"identity_actors", "status"}, {"identity_actors", "provisioning_fingerprint"}, {"identity_actors", "created_by_service"},
		{"identity_actor_roles", "password_hash"},
	} {
		var exists bool
		if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2)", legacy.table, legacy.column).Scan(&exists); err != nil {
			return fmt.Errorf("legacy schema check %s.%s: %w", legacy.table, legacy.column, err)
		}
		if exists {
			return fmt.Errorf("legacy identity column remains: %s.%s", legacy.table, legacy.column)
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

func requireColumns(ctx context.Context, db *sql.DB, req schemaRequirement) error {
	rows, err := db.QueryContext(ctx, "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", req.table)
	if err != nil {
		return fmt.Errorf("schema column census %s: %w", req.table, err)
	}
	found := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			_ = rows.Close()
			return fmt.Errorf("schema column scan %s: %w", req.table, err)
		}
		found[name] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("schema column rows %s: %w", req.table, err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("schema column close %s: %w", req.table, err)
	}
	for _, column := range req.columns {
		if !found[column] {
			return fmt.Errorf("required column missing: %s.%s", req.table, column)
		}
	}
	return nil
}

func requireIndexes(ctx context.Context, db *sql.DB, req schemaRequirement) error {
	rows, err := db.QueryContext(ctx, "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1", req.table)
	if err != nil {
		return fmt.Errorf("schema index census %s: %w", req.table, err)
	}
	found := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			_ = rows.Close()
			return fmt.Errorf("schema index scan %s: %w", req.table, err)
		}
		found[name] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("schema index rows %s: %w", req.table, err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("schema index close %s: %w", req.table, err)
	}
	for _, index := range req.indexes {
		if !found[index] {
			return fmt.Errorf("required index missing: %s", index)
		}
	}
	return nil
}
