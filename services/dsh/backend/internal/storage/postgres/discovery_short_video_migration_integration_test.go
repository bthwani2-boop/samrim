package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Runs against a disposable freshly migrated DB, never changing the active
// local DSH database. Ensures the actual SQL migration admits canonical videos.
func TestFreshReelsMediaMigration(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set DSH_DATABASE_URL to prove migration on a disposable DB")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqlSources []string) {
		if err := postgres.Migrate(ctx, db, records, sqlSources, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("fresh DSH migration failed: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("fresh DSH schema failed: %v", err)
		}
		var definition string
		if err := db.QueryRowContext(ctx, `SELECT pg_get_constraintdef(oid)
           FROM pg_constraint WHERE conrelid='dsh.discovery_content_media_assets'::regclass
           AND conname='discovery_content_media_type_chk'`).Scan(&definition); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(definition, "video/mp4") || !strings.Contains(definition, "image/jpeg") {
			t.Fatalf("migration failed to keep image and MP4 in the canonical media constraint: %s", definition)
		}
	})
}
