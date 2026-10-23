package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestMarketingPartnerParticipationSummaryDoesNotTruncateAfter100Campaigns(t *testing.T) {
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
		initial, err := postgres.ReadOperatorMarketingSummary(ctx, db)
		if err != nil || initial.PartnerInvitations != 0 {
			t.Fatalf("empty summary %+v: %v", initial, err)
		}
		for _, city := range []string{"summary-city-a", "summary-city-b"} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", city, "مدينة "+city); err != nil {
				t.Fatal(err)
			}
		}
		for _, fixture := range []canonicalStoreFixture{
			{ID: "summary-store-a", PartnerActorID: "partner-a", Name: "Partner A", ServiceCityID: "summary-city-a", PublicationState: "published"},
			{ID: "summary-store-b", PartnerActorID: "partner-b", Name: "Partner B", ServiceCityID: "summary-city-a", PublicationState: "published"},
			{ID: "summary-store-outside", PartnerActorID: "partner-c", Name: "Partner C", ServiceCityID: "summary-city-b", PublicationState: "published"},
		} {
			insertCanonicalStoreFixture(t, ctx, db, fixture)
		}
		for i := 0; i < 105; i++ {
			_, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_promotions
     (id,code,name_ar,kind,value_minor,funding_source,funding_share_partner_percent,discount_budget_limit_minor,
      service_city_id,requires_partner_opt_in,state,starts_at,created_by_actor_id)
     VALUES($1,$2,'حملة اختبار','PERCENTAGE',10,'SHARED',40,10000,
      'summary-city-a',true,'PUBLISHED',now()-interval '1 hour','operator-proof')`,
				fmt.Sprintf("summary-promo-%03d", i), fmt.Sprintf("SUMM%03d", i))
			if err != nil {
				t.Fatalf("promotion %d: %v", i, err)
			}
		}
		for _, v := range []struct{ promotionID, storeID, state string }{
			{"summary-promo-000", "summary-store-a", "OPTED_IN"},
			{"summary-promo-001", "summary-store-b", "DECLINED"},
		} {
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_promotion_store_opt_ins
      (promotion_id,store_id,actor_id,state,version) VALUES($1,$2,'partner-proof',$3,1)`,
				v.promotionID, v.storeID, v.state); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_promotions
     (id,code,name_ar,kind,value_minor,funding_source,service_city_id,requires_partner_opt_in,state,starts_at,created_by_actor_id)
     VALUES('summary-uncapped','SUMMUNCAPPED','حملة بلا سقف','PERCENTAGE',10,'PARTNER',
      'summary-city-a',true,'PUBLISHED',now()-interval '1 hour','operator-proof')`); err != nil {
			t.Fatal(err)
		}
		summary, err := postgres.ReadOperatorMarketingSummary(ctx, db)
		if err != nil {
			t.Fatal(err)
		}
		if summary.PartnerInvitations != 210 || summary.PartnerApproved != 1 || summary.PartnerDeclined != 1 || summary.PartnerPending != 208 {
			t.Fatalf("whole-registry counts wrong beyond first100 %+v", summary)
		}
		if summary.ActivePromotions != 106 {
			t.Fatalf("state count should include persisted uncapped row %+v", summary)
		}
	})
}
