package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

const (
	testPartnerActorID = "act_partner_dsh_baseline"
	testOtherActorID   = "act_other_dsh_baseline"
	testStoreID        = "store_partner_dsh_baseline"
	testIdempotencyKey = "idem_partner_dsh_baseline"
	testRequestHash    = "request-hash-dsh-baseline"
)

func TestFreshBaselineIntegrity(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh baseline proof")
		return
	}

	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if len(records) != postgres.SchemaVersion || len(migrationSQL) != postgres.SchemaVersion || records[0].Name != "001_partner_store_baseline.sql" {
			t.Fatalf("unexpected DSH baseline: records=%d sql=%d name=%s", len(records), len(migrationSQL), records[0].Name)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("apply fresh DSH baseline: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify fresh DSH baseline: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("rerun DSH baseline with matching checksum: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify rerun DSH baseline: %v", err)
		}

		if _, err := db.ExecContext(ctx, `
			INSERT INTO dsh.stores(id, partner_actor_id, name)
			VALUES($1, $2, 'Baseline Store')`, testStoreID, testPartnerActorID); err != nil {
			t.Fatalf("insert canonical Store: %v", err)
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO dsh.partner_bootstrap_idempotency
			(idempotency_key, request_hash, partner_actor_id, store_id)
			VALUES($1, $2, $3, $4)`, testIdempotencyKey, testRequestHash, testPartnerActorID, testStoreID); err != nil {
			t.Fatalf("insert canonical idempotency record: %v", err)
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO dsh.partner_bootstrap_idempotency
			(idempotency_key, request_hash, partner_actor_id, store_id)
			VALUES('idem_invalid_actor', $1, $2, $3)`, testRequestHash, testOtherActorID, testStoreID); err == nil {
			t.Fatal("database accepted idempotency actor/store mismatch")
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO dsh.partner_bootstrap_audit
			(event_type, idempotency_key, correlation_id, acting_actor_id, partner_actor_id, store_id, request_hash)
			VALUES('partner_bootstrap_created', $1, 'corr-invalid-actor', 'act_operator_dsh_baseline', $2, $3, $4)`, testIdempotencyKey, testOtherActorID, testStoreID, testRequestHash); err == nil {
			t.Fatal("database accepted audit actor/idempotency mismatch")
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO dsh.partner_bootstrap_audit
			(event_type, idempotency_key, correlation_id, acting_actor_id, partner_actor_id, store_id, request_hash)
			VALUES('partner_bootstrap_created', $1, 'corr-valid-baseline', 'act_operator_dsh_baseline', $2, $3, $4)`, testIdempotencyKey, testPartnerActorID, testStoreID, testRequestHash); err != nil {
			t.Fatalf("insert canonical audit record: %v", err)
		}

		var stores, idempotency, audit, history int
		for _, check := range []struct {
			name  string
			query string
			out   *int
		}{
			{"stores", "SELECT count(*) FROM dsh.stores", &stores},
			{"idempotency", "SELECT count(*) FROM dsh.partner_bootstrap_idempotency", &idempotency},
			{"audit", "SELECT count(*) FROM dsh.partner_bootstrap_audit", &audit},
			{"migration history", "SELECT count(*) FROM dsh.schema_migrations", &history},
		} {
			if err := db.QueryRowContext(ctx, check.query).Scan(check.out); err != nil {
				t.Fatalf("read %s: %v", check.name, err)
			}
		}
		if stores != 1 || idempotency != 1 || audit != 1 || history != 1 {
			t.Fatalf("unexpected baseline readback: stores=%d idempotency=%d audit=%d history=%d", stores, idempotency, audit, history)
		}
	})
}

func withFreshDatabase(t *testing.T, rootDB *sql.DB, databaseURL string, test func(context.Context, *sql.DB, []postgres.MigrationRecord, []string)) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	databaseName := fmt.Sprintf("dsh_baseline_test_%d", time.Now().UnixNano())
	if _, err := rootDB.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatalf("create isolated DSH database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := rootDB.ExecContext(cleanupCtx, "DROP DATABASE IF EXISTS "+databaseName+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated DSH database: %v", err)
		}
	})

	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse DSH database URL: %v", err)
	}
	parsedURL.Path = "/" + databaseName
	testDB, err := sql.Open("postgres", parsedURL.String())
	if err != nil {
		t.Fatalf("open isolated DSH database: %v", err)
	}
	t.Cleanup(func() { _ = testDB.Close() })
	if err := testDB.PingContext(ctx); err != nil {
		t.Fatalf("isolated DSH database is not reachable: %v", err)
	}
	records, migrationSQL, err := postgres.LoadMigrations(".")
	if err != nil {
		t.Fatalf("load DSH baseline: %v", err)
	}
	test(ctx, testDB, records, migrationSQL)
}
