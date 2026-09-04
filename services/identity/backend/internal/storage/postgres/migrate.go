package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

const SchemaVersion = 1

func Migrate(ctx context.Context, db *sql.DB, migrationSQL string) error {
	if migrationSQL == "" {
		return fmt.Errorf("identity migration is empty")
	}
	if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
		return fmt.Errorf("apply identity migration v1: %w", err)
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
	for _, relation := range []string{
		"identity_actors",
		"identity_activation_challenges",
		"identity_sessions",
		"identity_refresh_token_history",
		"identity_login_attempts",
		"identity_security_audit",
	} {
		var resolved sql.NullString
		if err := db.QueryRowContext(ctx, "SELECT to_regclass($1)", relation).Scan(&resolved); err != nil {
			return fmt.Errorf("relation check %s: %w", relation, err)
		}
		if !resolved.Valid || resolved.String == "" {
			return fmt.Errorf("required relation missing: %s", relation)
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
