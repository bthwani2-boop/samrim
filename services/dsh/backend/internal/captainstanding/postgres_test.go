package captainstanding

import (
	"database/sql"
	"testing"

	_ "github.com/lib/pq"
)

func TestCaptainStandingPostgresRejectsProtectedOrMalformedOwnerSchemas(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://localhost/no-connect?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := NewPostgresRepository(db, "dsh_test_captain_agent02"); err != nil {
		t.Fatalf("isolated dedicated DSH schema rejected: %v", err)
	}
	for _, unsafe := range []string{"", "public", "dsh", "dsh_test_", "identity_test_agent02", "dsh_test_a;DROP SCHEMA public", "dsh_test_a\"x", "dsh_test_a.b"} {
		if _, err := NewPostgresRepository(db, unsafe); err == nil {
			t.Fatalf("unsafe schema accepted: %q", unsafe)
		}
	}
	if _, err := NewPostgresRepository(nil, "dsh_test_captain_agent02"); err == nil {
		t.Fatal("nil database accepted")
	}
}
