package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestBannerPresentationVerifiedPersistenceAndReplay(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated PostgreSQL connection is not configured")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	var pingErr error
	for attempt := 0; attempt < 30; attempt++ {
		pingErr = root.PingContext(context.Background())
		if pingErr == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if pingErr != nil {
		t.Fatal(pingErr)
	}
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if os.Getenv("BANNER_SCHEMA_ONLY_TEST") == "1" {
			// Focused persistence proof when full historical bootstrap is unavailable.
			if _, err := db.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, sqls[144]); err != nil {
				t.Fatal(err)
			}
		} else {
			if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
				t.Fatal(err)
			}
		}
		first, err := postgres.ReadBannerPresentation(ctx, db)
		if err != nil || first.Mode != "CINEMATIC" || first.IntervalSeconds != 5 || first.Version != 1 {
			t.Fatalf("unexpected initial presentation: %+v %v", first, err)
		}

		saved, replayed, err := postgres.SetBannerPresentation(ctx, db, "CROSSFADE", 7, 1, "operator", "first-correlation", "banner-first")
		if err != nil || replayed || saved.Version != 2 || saved.Mode != "CROSSFADE" {
			t.Fatalf("unexpected save: %+v replayed=%v err=%v", saved, replayed, err)
		}
		same, replayed, err := postgres.SetBannerPresentation(ctx, db, "CROSSFADE", 7, 1, "operator", "retry-correlation", "banner-first")
		if err != nil || !replayed || same.Version != 2 {
			t.Fatalf("unexpected replay: %+v replayed=%v err=%v", same, replayed, err)
		}
		_, _, err = postgres.SetBannerPresentation(ctx, db, "STATIC", 5, 1, "operator", "second-correlation", "banner-second")
		if !errors.Is(err, postgres.ErrBannerPresentationConflict) {
			t.Fatalf("expected stale version conflict: %v", err)
		}
		_, _, err = postgres.SetBannerPresentation(ctx, db, "STATIC", 5, 1, "operator", "first-correlation", "banner-first")
		if !errors.Is(err, postgres.ErrBannerPresentationConflict) {
			t.Fatalf("expected idempotency conflict: %v", err)
		}
		result, err := postgres.ReadBannerPresentation(ctx, db)
		if err != nil || result.Mode != "CROSSFADE" || result.IntervalSeconds != 7 || result.Version != 2 {
			t.Fatalf("unexpected final record: %+v err=%v", result, err)
		}
		var events int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.marketing_banner_presentation_events WHERE placement='HOME'").Scan(&events); err != nil || events != 1 {
			t.Fatalf("expected one attributed audit event; count=%d err=%v", events, err)
		}
	})
}
