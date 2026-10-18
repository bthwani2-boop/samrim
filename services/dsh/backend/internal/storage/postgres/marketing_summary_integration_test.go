package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
	"os"
	"testing"
	"time"
)

func TestOperatorMarketingSummaryCountsAcrossPages(t *testing.T) {
	url := os.Getenv("DSH_DATABASE_URL")
	if url == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	if err = root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 105; i++ {
			id := fmt.Sprintf("summary-active-%03d", i)
			createPublishedPromotion(t, ctx, db, id, fmt.Sprintf("SUM%03d", i), "", "", time.Now().UTC().Add(-time.Hour))
		}
		page, err := postgres.ListOperatorPromotionRegistry(ctx, db, postgres.OperatorPromotionRegistryQuery{Sort: "starts_desc", Limit: 100})
		if err != nil || len(page.Promotions) != 100 || !page.HasMore {
			t.Fatalf("first page was not limited as expected: %+v err=%v", page, err)
		}
		summary, err := postgres.ReadOperatorMarketingSummary(ctx, db)
		if err != nil || summary.ActivePromotions != 105 {
			t.Fatalf("aggregates truncated: %+v err=%v", summary, err)
		}
	})
}
