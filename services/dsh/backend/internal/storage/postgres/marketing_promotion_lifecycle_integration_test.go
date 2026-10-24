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

// Exercise the real marketing owner: create draft, publish, public readback,
// pause, and idempotent replay. Nothing is written to the local working DB.
func TestPromotionDraftPublishAppearsAndPauseRemovesFromStore(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated PostgreSQL connection is not configured")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		budget := int64(30000)
		input := postgres.PromotionInput{
			ID: "isolated-approved-promotion", Code: "LOCAL10", NameAr: "عرض محلي",
			Kind: "PERCENTAGE", ValueMinor: 10, FundingSource: "BTHWANI",
			StartsAt: time.Now().Add(-time.Hour), CreatedByActorID: "operator-test", DiscountBudgetLimitMinor: &budget,
		}
		saved, replayed, err := postgres.CreatePromotion(ctx, db, input, "local-create-key", "local-create-hash")
		if err != nil || replayed || saved.State != "DRAFT" {
			t.Fatalf("create draft: %+v replay=%v err=%v", saved, replayed, err)
		}
		empty, err := postgres.ListPromotions(ctx, db, true, "city-any", "store-any")
		if err != nil || len(empty) != 0 {
			t.Fatalf("draft must remain hidden: count=%d err=%v", len(empty), err)
		}
		created, replayed, err := postgres.CreatePromotion(ctx, db, input, "local-create-key", "local-create-hash")
		if err != nil || !replayed || created.ID != saved.ID {
			t.Fatalf("create replay: %+v replay=%v err=%v", created, replayed, err)
		}
		published, replayed, err := postgres.SetPromotionState(ctx, db, saved.ID, "PUBLISHED", "local-publish-key", "local-publish-hash", saved.Version)
		if err != nil || replayed || published.State != "PUBLISHED" {
			t.Fatalf("publish: %+v replay=%v err=%v", published, replayed, err)
		}
		items, err := postgres.ListPromotions(ctx, db, true, "city-any", "store-any")
		if err != nil || len(items) != 1 || items[0].ID != input.ID {
			t.Fatalf("published must be available for this eligible store: %+v err=%v", items, err)
		}
		again, replayed, err := postgres.SetPromotionState(ctx, db, saved.ID, "PUBLISHED", "local-publish-key", "local-publish-hash", saved.Version)
		if err != nil || !replayed || again.Version != published.Version {
			t.Fatalf("publish replay: %+v replay=%v err=%v", again, replayed, err)
		}
		paused, replayed, err := postgres.SetPromotionState(ctx, db, saved.ID, "PAUSED", "local-pause-key", "local-pause-hash", published.Version)
		if err != nil || replayed || paused.State != "PAUSED" {
			t.Fatalf("pause: %+v replay=%v err=%v", paused, replayed, err)
		}
		hidden, err := postgres.ListPromotions(ctx, db, true, "city-any", "store-any")
		if err != nil || len(hidden) != 0 {
			t.Fatalf("paused promotion must disappear: count=%d err=%v", len(hidden), err)
		}
		// A legacy paused campaign without a cap must fail at publish too;
		// its state and idempotency records may not be advanced on rejection.
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET discount_budget_limit_minor=NULL WHERE id=$1", input.ID); err != nil {
			t.Fatal(err)
		}
		_, _, err = postgres.SetPromotionState(ctx, db, input.ID, "PUBLISHED", "uncapped-publish-key", "uncapped-publish-hash", paused.Version)
		if !errors.Is(err, postgres.ErrPromotionInvalid) {
			t.Fatalf("uncapped draft/paused campaign was published: %v", err)
		}
		current, err := postgres.ReadPromotion(ctx, db, input.ID)
		if err != nil || current.State != "PAUSED" || current.Version != paused.Version {
			t.Fatalf("rejected publish modified state: %+v err=%v", current, err)
		}
		// Previously published uncapped platform offers must not remain public.
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET discount_budget_limit_minor=NULL,state='PUBLISHED' WHERE id=$1", input.ID); err != nil {
			t.Fatal(err)
		}
		unsafe, err := postgres.ListPromotions(ctx, db, true, "city-any", "store-any")
		if err != nil || len(unsafe) != 0 {
			t.Fatalf("historical uncapped platform offer became visible: %+v err=%v", unsafe, err)
		}
	})
}
