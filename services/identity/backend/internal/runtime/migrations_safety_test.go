package runtime

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedRoleRecoveryMigrationIsRegistered(t *testing.T) {
	directory := filepath.Join("..", "..", "..", "database", "migrations")
	records, err := loadMigrationRecords(directory)
	if err != nil {
		t.Fatalf("load identity migrations: %v", err)
	}
	if len(records) != 25 {
		t.Fatalf("identity migration count = %d, want 25", len(records))
	}
	last := records[len(records)-1]
	if last.Version != 25 || last.Name != "025_managed_role_password_recovery.sql" {
		t.Fatalf("last identity migration = %#v, want v25 managed role password recovery", last)
	}
}

func TestRunMigrationsBlocksProductionBeforeDatabaseAccess(t *testing.T) {
	err := RunMigrations(
		context.Background(),
		"production",
		"postgres://identity:secret@unreachable.invalid:5432/identity?sslmode=verify-full",
		"not-used",
	)
	if err == nil || !strings.Contains(err.Error(), "blocked in production") {
		t.Fatalf("production migration was not blocked before database access: %v", err)
	}
}

func TestVerifySchemaBlocksProductionBeforeDatabaseAccess(t *testing.T) {
	err := VerifySchema(
		context.Background(),
		"production",
		"postgres://identity:secret@unreachable.invalid:5432/identity?sslmode=verify-full",
		"not-used",
	)
	if err == nil || !strings.Contains(err.Error(), "blocked in production") {
		t.Fatalf("production schema verification was not blocked before database access: %v", err)
	}
}
