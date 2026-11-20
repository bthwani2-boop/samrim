package discovery

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lib/pq"
)

func TestOwnerBackedCaptainStandingMigration(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("owner-backed PostgreSQL integration requires explicit isolated test mode")
	}
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	owner, err := New(db, fmt.Sprintf("dsh_test_captain_migrate_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()

	apply := func(name string) error {
		t.Helper()
		source, err := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		return owner.Migrate(ctx, source)
	}
	checkTables := func(want bool) {
		t.Helper()
		for _, table := range []string{"captain_standing", "captain_standing_commands", "captain_standing_audit"} {
			var exists bool
			if err := db.QueryRowContext(ctx, "SELECT pg_catalog.to_regclass($1) IS NOT NULL",
				owner.Schema+"."+table).Scan(&exists); err != nil || exists != want {
				t.Fatalf("table %s exists=%t want=%t err=%v", table, exists, want, err)
			}
		}
	}
	if err := apply("001_public_discovery.sql"); err != nil {
		t.Fatal(err)
	}
	const standingMigration = "006_captain_standing.sql"
	var postgresError *pq.Error
	if err := apply(standingMigration); !errors.As(err, &postgresError) || postgresError.Code != "42883" {
		t.Fatalf("expected missing audit trigger function before its prerequisite migration, got %v", err)
	}
	checkTables(false)

	for _, name := range []string{
		"002_store_orderability.sql", "003_service_city_timezone.sql",
		"004_store_availability_city_limits.sql", "005_store_operational_policy_commands.sql", standingMigration,
	} {
		if err := apply(name); err != nil {
			t.Fatalf("owner migration %s: %v", name, err)
		}
	}
	checkTables(true)
}
