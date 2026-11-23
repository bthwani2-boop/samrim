package discovery

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOwnerBackedCaptainStandingFreshBaseline(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("owner-backed PostgreSQL integration requires explicit isolated test mode")
	}
	db, err := OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	owner, err := New(db, fmt.Sprintf("dsh_test_captain_fresh_%x", time.Now().UnixNano()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()

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
	checkTables(false)
	if err := owner.BootstrapFresh(ctx, filepath.Join("..", "..", "..", "database", "schema")); err != nil {
		t.Fatal(err)
	}
	checkTables(true)
}
