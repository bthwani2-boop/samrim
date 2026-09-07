package runtime

import (
	"context"
	"strings"
	"testing"
)

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
