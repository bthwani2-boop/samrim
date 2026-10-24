package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestOperatorMarketingCampaignCreateRetryAndPagination(t *testing.T) {
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
		input := postgres.MarketingCampaignInput{NameAr: "حملة فحص", Objective: "CONVERSION", BudgetLimitMinor: 1800, CreatedByActorID: "operator-a"}
		first, replay, err := postgres.CreateOperatorMarketingCampaign(ctx, db, input, "operator-campaign-create-0001")
		if err != nil || replay || first.State != "DRAFT" || first.Version != 1 {
			t.Fatalf("first campaign %+v replay=%v err=%v", first, replay, err)
		}
		again, replay, err := postgres.CreateOperatorMarketingCampaign(ctx, db, input, "operator-campaign-create-0001")
		if err != nil || !replay || again.ID != first.ID {
			t.Fatalf("replay changed campaign %+v replay=%v err=%v", again, replay, err)
		}
		mutated := input
		mutated.BudgetLimitMinor = 8000
		_, _, err = postgres.CreateOperatorMarketingCampaign(ctx, db, mutated, "operator-campaign-create-0001")
		if !errors.Is(err, postgres.ErrMarketingCampaignIdempotencyConflict) {
			t.Fatalf("same key changed budget: %v", err)
		}
		mutated = input
		mutated.CreatedByActorID = "operator-b"
		other, replay, err := postgres.CreateOperatorMarketingCampaign(ctx, db, mutated, "operator-campaign-create-0001")
		if err != nil || replay || other.ID == first.ID {
			t.Fatalf("actor collision %+v replay=%v err=%v", other, replay, err)
		}
		for n, key := range []string{"operator-campaign-create-0002", "operator-campaign-create-0003"} {
			another := input
			another.NameAr = "حملة فرعية " + string(rune('a'+n))
			if _, _, err := postgres.CreateOperatorMarketingCampaign(ctx, db, another, key); err != nil {
				t.Fatal(err)
			}
		}
		page1, err := postgres.ListOperatorMarketingCampaigns(ctx, db, "", "", 2)
		if err != nil || len(page1.Items) != 2 || page1.NextCursor == "" {
			t.Fatalf("first page %+v err=%v", page1, err)
		}
		page2, err := postgres.ListOperatorMarketingCampaigns(ctx, db, "", page1.NextCursor, 2)
		if err != nil || len(page2.Items) != 2 || page2.NextCursor != "" {
			t.Fatalf("second page %+v err=%v", page2, err)
		}
		if page1.Items[1].ID >= page2.Items[0].ID || page1.Items[0].ID == page2.Items[0].ID {
			t.Fatal("pagination repeated records")
		}
		if _, err := postgres.ListOperatorMarketingCampaigns(ctx, db, "INVALID", "", 2); !errors.Is(err, postgres.ErrMarketingCampaignInvalid) {
			t.Fatalf("invalid filter accepted: %v", err)
		}
		if _, err := postgres.ListOperatorMarketingCampaigns(ctx, db, "", "", 101); !errors.Is(err, postgres.ErrMarketingCampaignInvalid) {
			t.Fatalf("oversized list accepted: %v", err)
		}
		if _, err := postgres.ListOperatorMarketingCampaigns(ctx, db, "PUBLISHED", "", 10); err != nil {
			t.Fatal(err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.marketing_campaigns").Scan(&count); err != nil || count != 4 {
			t.Fatalf("idempotency created duplicates %d err=%v", count, err)
		}
	})
}
