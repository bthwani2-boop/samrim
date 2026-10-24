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

func TestMarketingCampaignRegistryOwnsMembershipAndSharedBudget(t *testing.T) {
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
		in := postgres.MarketingCampaignInput{ID: "marketing-owner-a", NameAr: "حملة موحدة", Objective: "CONVERSION", BudgetLimitMinor: 100, CreatedByActorID: "operator-a"}
		campaign, err := postgres.CreateMarketingCampaign(ctx, db, in)
		if err != nil || campaign.State != "DRAFT" || campaign.Version != 1 || campaign.BudgetLimitMinor != 100 {
			t.Fatalf("campaign create %+v err=%v", campaign, err)
		}
		if _, err := postgres.CreateMarketingCampaign(ctx, db, postgres.MarketingCampaignInput{ID: "bad", NameAr: "Bad", Objective: "NOT_AN_OBJECTIVE", BudgetLimitMinor: 100, CreatedByActorID: "operator-a"}); !errors.Is(err, postgres.ErrMarketingCampaignInvalid) {
			t.Fatalf("invalid objective accepted %v", err)
		}
		cap := int64(60)
		for _, info := range []struct{ id, code string }{{"campaign-promo-a", "CAMP10A"}, {"campaign-promo-b", "CAMP10B"}} {
			_, _, err := postgres.CreatePromotion(ctx, db, postgres.PromotionInput{
				ID: info.id, Code: info.code, NameAr: "خصم الحملة",
				Kind: "PERCENTAGE", ValueMinor: 10, FundingSource: "BTHWANI",
				DiscountBudgetLimitMinor: &cap, StartsAt: time.Now().UTC().Add(time.Hour),
				CreatedByActorID: "operator-a",
			}, info.id+"-idem", info.id+"-hash")
			if err != nil {
				t.Fatal(err)
			}
		}
		first, err := postgres.LinkMarketingCampaignPromotion(ctx, db, in.ID, "campaign-promo-a", 1)
		if err != nil || first.PromotionCount != 1 || first.AssignedPromotionBudgetMinor != 60 || first.Version != 2 {
			t.Fatalf("first link %+v err=%v", first, err)
		}
		_, err = postgres.LinkMarketingCampaignPromotion(ctx, db, in.ID, "campaign-promo-b", 1)
		if !errors.Is(err, postgres.ErrMarketingCampaignVersionConflict) {
			t.Fatalf("stale version allowed: %v", err)
		}
		_, err = postgres.LinkMarketingCampaignPromotion(ctx, db, in.ID, "campaign-promo-b", 2)
		if !errors.Is(err, postgres.ErrMarketingCampaignBudgetExceeded) {
			t.Fatalf("overbudget promotion accepted: %v", err)
		}
		after, err := postgres.ReadMarketingCampaign(ctx, db, in.ID)
		if err != nil || after.AssignedPromotionBudgetMinor != 60 || after.Version != 2 {
			t.Fatalf("rejected mutation changed campaign: %+v err=%v", after, err)
		}
		other := in
		other.ID = "marketing-owner-b"
		if _, err := postgres.CreateMarketingCampaign(ctx, db, other); err != nil {
			t.Fatal(err)
		}
		_, err = postgres.LinkMarketingCampaignPromotion(ctx, db, other.ID, "campaign-promo-a", 1)
		if !errors.Is(err, postgres.ErrMarketingCampaignInvalid) {
			t.Fatalf("promotion stolen by another campaign: %v", err)
		}
		for _, info := range []struct{ id, targetType, targetID string }{
			{"campaign-content-info", "INFO", ""},
			{"campaign-content-mismatched", "PROMOTION", "campaign-promo-b"},
			{"campaign-content-promo", "PROMOTION", "campaign-promo-a"},
		} {
			_, err = db.ExecContext(ctx, `INSERT INTO dsh.discovery_content
    (id,kind,title_ar,body_ar,target_type,target_id,starts_at,created_by_actor_id)
    VALUES($1,'BANNER','إعلان حملة','',$2,NULLIF($3,''),now()+interval '1 hour','operator-a')`,
				info.id, info.targetType, info.targetID)
			if err != nil {
				t.Fatal(err)
			}
		}
		_, err = postgres.LinkMarketingCampaignContent(ctx, db, in.ID, "campaign-content-mismatched", 2)
		if !errors.Is(err, postgres.ErrMarketingCampaignInvalid) {
			t.Fatalf("creative targeting an unlinked promotion accepted: %v", err)
		}
		withInfo, err := postgres.LinkMarketingCampaignContent(ctx, db, in.ID, "campaign-content-info", 2)
		if err != nil || withInfo.ContentCount != 1 || withInfo.Version != 3 {
			t.Fatalf("info content link %+v err=%v", withInfo, err)
		}
		withCreative, err := postgres.LinkMarketingCampaignContent(ctx, db, in.ID, "campaign-content-promo", 3)
		if err != nil || withCreative.ContentCount != 2 || withCreative.Version != 4 {
			t.Fatalf("promotion creative %+v err=%v", withCreative, err)
		}
		_, err = postgres.LinkMarketingCampaignContent(ctx, db, other.ID, "campaign-content-info", 1)
		if !errors.Is(err, postgres.ErrMarketingCampaignInvalid) {
			t.Fatalf("creative assigned to two campaigns: %v", err)
		}
		if _, err = db.ExecContext(ctx, "UPDATE dsh.marketing_campaigns SET state='PUBLISHED' WHERE id=$1", in.ID); err != nil {
			t.Fatal(err)
		}
		_, err = postgres.LinkMarketingCampaignPromotion(ctx, db, in.ID, "campaign-promo-b", 4)
		if !errors.Is(err, postgres.ErrMarketingCampaignInvalid) {
			t.Fatalf("mutated an active campaign: %v", err)
		}
		var linkedPromoCount int
		if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.marketing_campaign_promotion_links WHERE campaign_id=$1", in.ID).Scan(&linkedPromoCount); err != nil || linkedPromoCount != 1 {
			t.Fatalf("unexpected linked promotions %d err=%v", linkedPromoCount, err)
		}
	})
}
