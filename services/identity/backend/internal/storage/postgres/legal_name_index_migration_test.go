package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	identityactor "github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	identityruntime "github.com/bthwani2-boop/samrim/services/identity/backend/internal/runtime"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/storage/postgres"
)

func TestIdentityLegalNameIndexMigrationRetainsHistoricalNames(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("an isolated IDENTITY_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Clean("../../../../database/migrations")
	records, err := postgres.LoadMigrationRecords(directory)
	if err != nil {
		t.Fatalf("load canonical Identity migrations: %v", err)
	}
	if len(records) != postgres.SchemaVersion || records[29].Name != "030_retire_redundant_legal_name_version_index.sql" {
		t.Fatalf("unexpected canonical Identity SQL migration tail: %+v", records[len(records)-1])
	}

	// A fresh database proves all canonical SQL (not a mock or a cached schema).
	t.Run("fresh-v30", func(t *testing.T) {
		database, url := createIsolatedMigrationDatabase(t, ctx, root, databaseURL, "id_legal_fresh")
		if err := identityruntime.RunMigrations(ctx, "development", url, directory); err != nil {
			t.Fatalf("fresh canonical SQL bootstrap: %v", err)
		}
		verifyLegalNameIndexes(t, ctx, database, false)
		if err := postgres.VerifyMigrationHistory(ctx, database, records); err != nil {
			t.Fatalf("fresh migration history: %v", err)
		}
	})

	// The actual v29 -> v30 cutover starts with retained, owned Identity facts.
	t.Run("retained-v29-upgrade", func(t *testing.T) {
		database, url := createIsolatedMigrationDatabase(t, ctx, root, databaseURL, "id_legal_upgrade")
		for _, record := range records[:29] {
			sqlBody, err := os.ReadFile(filepath.Join(directory, record.Name))
			if err != nil {
				t.Fatalf("read v%d: %v", record.Version, err)
			}
			if err := postgres.Migrate(ctx, database, record.Version, record.Name, record.SHA256, string(sqlBody)); err != nil {
				t.Fatalf("construct historical v%d: %v", record.Version, err)
			}
		}
		if err := postgres.SynchronizeMigrationHistory(ctx, database, records[:29]); err != nil {
			t.Fatalf("verify historical migration history: %v", err)
		}
		verifyLegalNameIndexes(t, ctx, database, true)
		for _, actor := range []struct{ id, phone string }{
			{"id_legal_name_subject", "+967770001901"},
			{"id_legal_name_submitter", "+967770001902"},
			{"id_legal_name_verifier", "+967770001903"},
		} {
			if _, err := database.ExecContext(ctx,
				"INSERT INTO identity_actors(id, phone_e164) VALUES($1,$2)", actor.id, actor.phone); err != nil {
				t.Fatalf("insert isolated Identity actor: %v", err)
			}
		}
		const subject = "id_legal_name_subject"
		for _, version := range []int{1, 2, 3} {
			status := "PENDING_VERIFICATION"
			if version == 2 {
				status = "VERIFIED"
			}
			if _, err := database.ExecContext(ctx, `INSERT INTO identity_actor_legal_name_versions(
					actor_id, version, given_name, second_name, third_name, family_name, status,
					evidence_reference, submitted_by_actor_id, verified_by_actor_id, verified_at,
					verification_evidence_reference
				) VALUES($1,$2,$3,'ثابت','ثابت','ثابت',$4,$5,'id_legal_name_submitter',
					CASE WHEN $4='VERIFIED' THEN 'id_legal_name_verifier' ELSE NULL END,
					CASE WHEN $4='VERIFIED' THEN clock_timestamp() ELSE NULL END,
					CASE WHEN $4='VERIFIED' THEN 'isolated-review-evidence' ELSE NULL END)`,
				subject, version, "نسخة محفوظة", status, "isolated-submission-evidence"); err != nil {
				t.Fatalf("insert retained legal-name version %d: %v", version, err)
			}
		}
		if _, err := database.ExecContext(ctx,
			"INSERT INTO identity_actor_legal_names(actor_id, current_version) VALUES($1,2)", subject); err != nil {
			t.Fatal(err)
		}
		if _, err := database.ExecContext(ctx, `INSERT INTO identity_actor_legal_name_events(
			id,actor_id,version,event_type,acting_actor_id,evidence_reference,idempotency_key,
			request_hash,correlation_id
		) VALUES('id_legal_name_event', $1,3,'LEGAL_NAME_SUBMITTED','id_legal_name_submitter',
			'isolated-submission-evidence','isolated-idempotency-legal-v3','isolated-hash',
			'isolated-correlation')`, subject); err != nil {
			t.Fatal(err)
		}
		identity := identityactor.New(database, "")
		beforePending, err := identity.ReadPendingLegalName(ctx, subject)
		if err != nil || beforePending.Version != 3 {
			t.Fatalf("pending name before migration: %+v err=%v", beforePending, err)
		}
		beforeVerified, err := identity.ReadVerifiedLegalName(ctx, subject)
		if err != nil || beforeVerified.Version != 2 {
			t.Fatalf("verified name before migration: %+v err=%v", beforeVerified, err)
		}
		if err := identityruntime.RunMigrations(ctx, "development", url, directory); err != nil {
			t.Fatalf("upgrade retained v29 Identity SQL to v30: %v", err)
		}
		verifyLegalNameIndexes(t, ctx, database, false)
		afterPending, err := identity.ReadPendingLegalName(ctx, subject)
		if err != nil || !reflect.DeepEqual(beforePending, afterPending) {
			t.Fatalf("retained pending legal-name readback changed: before=%+v after=%+v err=%v", beforePending, afterPending, err)
		}
		afterVerified, err := identity.ReadVerifiedLegalName(ctx, subject)
		if err != nil || !reflect.DeepEqual(beforeVerified, afterVerified) {
			t.Fatalf("retained verified legal-name readback changed: before=%+v after=%+v err=%v", beforeVerified, afterVerified, err)
		}
		if _, err := identity.ReadPendingLegalName(ctx, "id_legal_name_verifier"); !errors.Is(err, identityactor.ErrLegalNameNotFound) {
			t.Fatalf("cross-actor pending-name read did not remain empty: %v", err)
		}
		var count, latestVersion, eventCount, currentVerifiedVersion int
		err = database.QueryRowContext(ctx, "SELECT count(*), max(version) FROM identity_actor_legal_name_versions WHERE actor_id=$1", subject).Scan(&count, &latestVersion)
		if err != nil || count != 3 || latestVersion != 3 {
			t.Fatalf("retained version count/max = %d/%d err=%v", count, latestVersion, err)
		}
		if err := database.QueryRowContext(ctx, "SELECT current_version FROM identity_actor_legal_names WHERE actor_id=$1", subject).Scan(&currentVerifiedVersion); err != nil || currentVerifiedVersion != 2 {
			t.Fatalf("retained current verified version=%d err=%v", currentVerifiedVersion, err)
		}
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM identity_actor_legal_name_events WHERE actor_id=$1", subject).Scan(&eventCount); err != nil || eventCount != 1 {
			t.Fatalf("retained audit events=%d err=%v", eventCount, err)
		}
		if err := postgres.VerifyMigrationHistory(ctx, database, records); err != nil {
			t.Fatalf("upgraded migration history: %v", err)
		}
		beforeNoOp := readMigrationNoOpSnapshot(t, database)
		if err := identityruntime.RunMigrations(ctx, "development", url, directory); err != nil {
			t.Fatalf("second SQL migration run: %v", err)
		}
		assertMigrationNoOpSnapshotUnchanged(t, beforeNoOp, readMigrationNoOpSnapshot(t, database))
	})
}

func verifyLegalNameIndexes(t *testing.T, ctx context.Context, db *sql.DB, obsoleteExpected bool) {
	t.Helper()
	var pkExists, obsoleteExists bool
	if err := db.QueryRowContext(ctx, `SELECT
		to_regclass('public.identity_actor_legal_name_versions_pkey') IS NOT NULL,
		to_regclass('public.identity_actor_legal_name_versions_latest_idx') IS NOT NULL`).Scan(&pkExists, &obsoleteExists); err != nil {
		t.Fatal(err)
	}
	if !pkExists || obsoleteExists != obsoleteExpected {
		t.Fatalf("legal-name indexes: PK=%t redundant=%t expected redundant=%t", pkExists, obsoleteExists, obsoleteExpected)
	}
}
