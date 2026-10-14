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

// Verify a fresh isolated database and a real v123-to-v127 upgrade, without
// resetting or mutating the persistent local development database.
func TestIntegrationMigrations124Through128FreshAndUpgrade(t *testing.T) {
	rootURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if rootURL == "" {
		t.Skip("DSH_DATABASE_URL must point to a disposable PostgreSQL server")
	}
	rootDB, err := sql.Open("postgres", rootURL)
	if err != nil {
		t.Fatal(err)
	}
	defer rootDB.Close()
	if err := rootDB.Ping(); err != nil {
		t.Fatal(err)
	}

	for _, scenario := range []struct {
		name   string
		prefix int
	}{
		{name: "fresh", prefix: 0},
		{name: "upgrade-from-v123", prefix: 123},
		{name: "upgrade-from-v127", prefix: 127},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			withFreshDatabase(t, rootDB, rootURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, source []string) {
				if scenario.prefix > 0 {
					if err := applyMigrationPrefix(ctx, db, records, source, scenario.prefix); err != nil {
						t.Fatal(err)
					}
					if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('pr96-city','Preserved City',true)"); err != nil {
						t.Fatal(err)
					}
				}
				if err := postgres.Migrate(ctx, db, records, source, testDeliveryProofKeyring(t)); err != nil {
					t.Fatal(err)
				}

				var count, latest int
				if err := db.QueryRowContext(ctx, "SELECT count(*), max(version) FROM dsh.schema_migrations").Scan(&count, &latest); err != nil {
					t.Fatal(err)
				}
				if count != 128 || latest != 128 {
					t.Fatalf("migration graph not committed: count=%d latest=%d", count, latest)
				}
				expected := []string{"124_promotion_discount_budget.sql", "125_store_cover_media.sql", "126_store_internal_photos.sql", "127_captain_presence_latest.sql", "128_captain_parallel_dispatch.sql"}
				rows, err := db.QueryContext(ctx, "SELECT name FROM dsh.schema_migrations WHERE version BETWEEN 124 AND 128 ORDER BY version")
				if err != nil {
					t.Fatal(err)
				}
				defer rows.Close()
				var names []string
				for rows.Next() {
					var name string
					if err := rows.Scan(&name); err != nil {
						t.Fatal(err)
					}
					names = append(names, name)
				}
				if err := rows.Err(); err != nil {
					t.Fatal(err)
				}
				if len(names) != len(expected) {
					t.Fatalf("new migration count: %v", names)
				}
				for i := range expected {
					if names[i] != expected[i] {
						t.Fatalf("migration[%d]=%s expected=%s", i, names[i], expected[i])
					}
				}

				var newColumns int
				if err := db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema='dsh' AND table_name='commerce_promotions' AND column_name IN ('discount_budget_limit_minor','discount_spent_minor')").Scan(&newColumns); err != nil {
					t.Fatal(err)
				}
				if newColumns != 2 {
					t.Fatalf("discount budget columns: %d", newColumns)
				}

				var tableCount int
				if err := db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='dsh' AND table_name IN ('store_internal_photos','captain_presence_latest')").Scan(&tableCount); err != nil {
					t.Fatal(err)
				}
				if tableCount != 2 {
					t.Fatalf("new tables: %d", tableCount)
				}

				if scenario.prefix > 0 {
					var preserved string
					if err := db.QueryRowContext(ctx, "SELECT display_name_ar FROM dsh.service_cities WHERE id='pr96-city'").Scan(&preserved); err != nil {
						t.Fatal(err)
					}
					if preserved != "Preserved City" {
						t.Fatalf("v123 existing row changed: %q", preserved)
					}
				}
			})
		})
	}
}
