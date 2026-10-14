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

// A completed campaign must never become active again through an intermediate
// PAUSED transition, even if the caller knows the exact current version.
func TestPromotionTerminalStateCannotBeReactivated(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated promotion transition proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply migrations: %v", err)
		}
		startsAt := time.Now().UTC().Add(-time.Hour)
		createPublishedPromotion(t, ctx, db, "terminated-promotion", "TERMINATED", "", "", startsAt)
		ended, replayed, err := postgres.SetPromotionState(ctx, db, "terminated-promotion", "ENDED", "end-terminated", postgres.HashMarketingFacts("ended"), 2)
		if err != nil || replayed || ended.State != "ENDED" || ended.Version != 3 {
			t.Fatalf("ending published promotion: %+v replayed=%t err=%v", ended, replayed, err)
		}
		_, _, err = postgres.SetPromotionState(ctx, db, ended.ID, "PAUSED", "pause-ended", postgres.HashMarketingFacts("pause-ended"), ended.Version)
		if !errors.Is(err, postgres.ErrPromotionNotFound) {
			t.Fatalf("terminal promotion must reject PAUSED with current version, got %v", err)
		}
		_, _, err = postgres.SetPromotionState(ctx, db, ended.ID, "PUBLISHED", "publish-ended", postgres.HashMarketingFacts("publish-ended"), ended.Version)
		if !errors.Is(err, postgres.ErrPromotionNotFound) {
			t.Fatalf("terminal promotion must reject PUBLISHED, got %v", err)
		}
		current, err := postgres.ReadPromotion(ctx, db, ended.ID)
		if err != nil || current.State != "ENDED" || current.Version != ended.Version {
			t.Fatalf("rejected transitions must preserve terminal state: %+v err=%v", current, err)
		}
		published, err := postgres.ReadPromotion(ctx, db, "terminated-promotion")
		if err != nil || published.State != "ENDED" {
			t.Fatalf("terminal state readback: %+v err=%v", published, err)
		}
		createPublishedPromotion(t, ctx, db, "pausable-promotion", "PAUSABLE", "", "", startsAt)
		paused, _, err := postgres.SetPromotionState(ctx, db, "pausable-promotion", "PAUSED", "pause-live", postgres.HashMarketingFacts("pause-live"), 2)
		if err != nil || paused.State != "PAUSED" {
			t.Fatalf("published -> paused must remain supported: %+v err=%v", paused, err)
		}
		resumed, _, err := postgres.SetPromotionState(ctx, db, paused.ID, "PUBLISHED", "resume-live", postgres.HashMarketingFacts("resume-live"), paused.Version)
		if err != nil || resumed.State != "PUBLISHED" {
			t.Fatalf("paused -> published must remain supported: %+v err=%v", resumed, err)
		}
	})
}
