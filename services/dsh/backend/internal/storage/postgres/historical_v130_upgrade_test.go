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

// This fixture changes ONLY a short-lived isolated test database. Historical
// migration history in the user's durable local database is never rewritten.
func TestHistoricalV130ChecksumAllowedOnlyForVerifiedLocalSchema(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("DSH_DATABASE_URL required")
	}
	t.Setenv("BTHWANI_ENV", "development")
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, scripts []string) {
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		historic := "da7c2732bf7412af8e3cb24af40cb39afeefe03d938a6c48f3a1bc68059ca02c"
		if _, err := db.ExecContext(ctx, "UPDATE dsh.schema_migrations SET sha256=$1 WHERE version=130", historic); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("known local checksum with verified constraint: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("known local upgrade: %v", err)
		}
		var stored string
		if err := db.QueryRowContext(ctx, "SELECT sha256 FROM dsh.schema_migrations WHERE version=130").Scan(&stored); err != nil {
			t.Fatal(err)
		}
		if stored != historic {
			t.Fatalf("migration history was rewritten")
		}
		t.Setenv("BTHWANI_ENV", "staging")
		if err := postgres.VerifySchema(ctx, db, records); err == nil {
			t.Fatal("staging accepted an old checksum")
		}
		t.Setenv("BTHWANI_ENV", "development")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.schema_migrations SET sha256=$1 WHERE version=130", strings.Repeat("f", 64)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err == nil {
			t.Fatal("unrecognized checksum accepted")
		}
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err == nil {
			t.Fatal("migrator accepted unrecognized checksum")
		}
	})
}
