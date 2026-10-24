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

func TestMarketingCampaignLifecyclePreflightReplayAndAudit(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated PostgreSQL connection required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		campaign, err := postgres.CreateMarketingCampaign(ctx, db, postgres.MarketingCampaignInput{
			ID: "lifecycle-guard", NameAr: "حملة دورة", Objective: "CONVERSION",
			BudgetLimitMinor: 1000, CreatedByActorID: "operator-a",
		})
		if err != nil {
			t.Fatal(err)
		}
		next := func(state, key string, version int) (postgres.MarketingCampaignRecord, bool, error) {
			return postgres.SetMarketingCampaignState(ctx, db, campaign.ID, state, "operator-a", "trace-a", key, version)
		}
		_, _, err = next("PUBLISHED", "campaign-empty-guard", 1)
		if !errors.Is(err, postgres.ErrMarketingCampaignNotReady) {
			t.Fatalf("empty campaign published: %v", err)
		}
		cap := int64(100)
		promo, _, err := postgres.CreatePromotion(ctx, db, postgres.PromotionInput{
			ID: "campaign-lifecycle-promo", Code: "LIFECYCLE10", NameAr: "خصم معتمد",
			Kind: "PERCENTAGE", ValueMinor: 10, FundingSource: "BTHWANI",
			DiscountBudgetLimitMinor: &cap, StartsAt: time.Now().Add(-time.Hour),
			CreatedByActorID: "operator-a",
		}, "lifecycle-promo-create", "lifecycle-promo-hash")
		if err != nil {
			t.Fatal(err)
		}
		linked, err := postgres.LinkMarketingCampaignPromotion(ctx, db, campaign.ID, promo.ID, 1)
		if err != nil || linked.Version != 2 {
			t.Fatalf("link %+v %v", linked, err)
		}
		_, _, err = next("PUBLISHED", "campaign-draft-child", 2)
		if !errors.Is(err, postgres.ErrMarketingCampaignNotReady) {
			t.Fatalf("draft offer approved: %v", err)
		}
		_, _, err = postgres.SetPromotionState(ctx, db, promo.ID, "PUBLISHED", "lifecycle-child-publish", "lifecycle-child-hash", promo.Version)
		if err != nil {
			t.Fatal(err)
		}
		active, replayed, err := next("PUBLISHED", "campaign-lifecycle-start", 2)
		if err != nil || replayed || active.State != "PUBLISHED" || active.Version != 3 {
			t.Fatalf("publish %+v replay=%v err=%v", active, replayed, err)
		}
		replay, replayed, err := next("PUBLISHED", "campaign-lifecycle-start", 2)
		if err != nil || !replayed || replay.Version != 3 {
			t.Fatalf("replay %+v %v %v", replay, replayed, err)
		}
		_, _, err = next("PAUSED", "campaign-lifecycle-start", 3)
		if !errors.Is(err, postgres.ErrMarketingCampaignVersionConflict) {
			t.Fatalf("reused idempotency key accepted: %v", err)
		}
		paused, _, err := next("PAUSED", "campaign-lifecycle-pause", 3)
		if err != nil || paused.State != "PAUSED" || paused.Version != 4 {
			t.Fatalf("pause %+v %v", paused, err)
		}
		_, _, err = next("PUBLISHED", "campaign-lifecycle-stale", 3)
		if !errors.Is(err, postgres.ErrMarketingCampaignVersionConflict) {
			t.Fatalf("stale resume accepted: %v", err)
		}
		resumed, _, err := next("PUBLISHED", "campaign-lifecycle-resume", 4)
		if err != nil || resumed.State != "PUBLISHED" || resumed.Version != 5 {
			t.Fatalf("resume %+v %v", resumed, err)
		}
		ended, _, err := next("ENDED", "campaign-lifecycle-end", 5)
		if err != nil || ended.State != "ENDED" || ended.Version != 6 {
			t.Fatalf("end %+v %v", ended, err)
		}
		_, _, err = next("PUBLISHED", "campaign-lifecycle-resurrect", 6)
		if !errors.Is(err, postgres.ErrMarketingCampaignInvalid) {
			t.Fatalf("ended campaign resurrected: %v", err)
		}
		archived, _, err := next("ARCHIVED", "campaign-lifecycle-archive", 6)
		if err != nil || archived.State != "ARCHIVED" || archived.Version != 7 {
			t.Fatalf("archive %+v %v", archived, err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.marketing_campaign_state_events WHERE campaign_id=$1", campaign.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 5 {
			t.Fatalf("want 5 append-only state events; got %d", count)
		}
		var oldState, newState string
		if err := db.QueryRowContext(ctx, "SELECT previous_state,resulting_state FROM dsh.marketing_campaign_state_events WHERE campaign_id=$1 AND result_version=3", campaign.ID).Scan(&oldState, &newState); err != nil {
			t.Fatal(err)
		}
		if oldState != "DRAFT" || newState != "PUBLISHED" {
			t.Fatalf("audit mismatch %s %s", oldState, newState)
		}
	})
}
