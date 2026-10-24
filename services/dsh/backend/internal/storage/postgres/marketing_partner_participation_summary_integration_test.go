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
		// The operator inbox must traverse more than 100 eligible Stores without
		// relying on the first promotion registry page or leaking customers.
		for i := 0; i < 101; i++ {
			storeID := fmt.Sprintf("summary-store-extra-%03d", i)
			_, err := db.ExecContext(ctx, `INSERT INTO dsh.stores(
				id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state)
				SELECT $1,$2,$3,service_city_id,primary_vertical_id,commercial_store_type_id,'published'
				FROM dsh.stores WHERE id='summary-store-a'`,
				storeID, "partner-"+storeID, "Extra Store "+storeID)
			if err != nil {
				t.Fatal(err)
			}
		}
		seen := make(map[string]bool)
		cursor := ""
		for {
			page, err := postgres.ListOperatorPartnerDecisions(ctx, db, "summary-promo-000", cursor, "", 25)
			if err != nil {
				t.Fatal(err)
			}
			if len(page.Items) > 25 {
				t.Fatalf("page too big: %d", len(page.Items))
			}
			for _, item := range page.Items {
				if seen[item.StoreID] {
					t.Fatalf("duplicate Store across pages: %s", item.StoreID)
				}
				seen[item.StoreID] = true
			}
			if page.NextCursor == "" {
				break
			}
			if page.NextCursor == cursor {
				t.Fatal("cursor did not advance")
			}
			cursor = page.NextCursor
		}
		if len(seen) != 103 {
			t.Fatalf("expected 103 Store decisions across pages, got %d", len(seen))
		}
		approved, err := postgres.ListOperatorPartnerDecisions(ctx, db, "summary-promo-000", "", "OPTED_IN", 25)
		if err != nil || len(approved.Items) != 1 || approved.Items[0].StoreID != "summary-store-a" {
			t.Fatalf("approved filter: %+v err=%v", approved, err)
		}
		declined, err := postgres.ListOperatorPartnerDecisions(ctx, db, "summary-promo-001", "", "DECLINED", 25)
		if err != nil || len(declined.Items) != 1 || declined.Items[0].StoreID != "summary-store-b" {
			t.Fatalf("declined filter: %+v err=%v", declined, err)
		}
		pending, err := postgres.ListOperatorPartnerDecisions(ctx, db, "summary-promo-000", "", "PENDING", 25)
		if err != nil || len(pending.Items) != 25 || pending.NextCursor == "" {
			t.Fatalf("pending filter: %+v err=%v", pending, err)
		}
		// Historical commercial decisions must remain auditable when a Store
		// stops publishing or moves outside the current campaign city.
		if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET publication_state='hidden' WHERE id='summary-store-a'"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET service_city_id='summary-city-b' WHERE id='summary-store-b'"); err != nil {
			t.Fatal(err)
		}
		approvedHistory, err := postgres.ListOperatorPartnerDecisions(ctx, db, "summary-promo-000", "", "OPTED_IN", 25)
		if err != nil || len(approvedHistory.Items) != 1 || approvedHistory.Items[0].StoreID != "summary-store-a" || approvedHistory.Items[0].StorePublished {
			t.Fatalf("hidden Store consent missing from audit readback: %+v err=%v", approvedHistory, err)
		}
		declinedHistory, err := postgres.ListOperatorPartnerDecisions(ctx, db, "summary-promo-001", "", "DECLINED", 25)
		if err != nil || len(declinedHistory.Items) != 1 || declinedHistory.Items[0].StoreID != "summary-store-b" {
			t.Fatalf("Store decision must survive a city move: %+v err=%v", declinedHistory, err)
		}
		currentPending, err := postgres.ListOperatorPartnerDecisions(ctx, db, "summary-promo-000", "", "PENDING", 100)
		if err != nil || len(currentPending.Items) != 100 {
			t.Fatalf("pending must exclude ineligible/history-only Stores: count=%d err=%v", len(currentPending.Items), err)
		}
		if _, err := postgres.ListOperatorPartnerDecisions(ctx, db, "unknown-campaign", "", "", 25); err == nil {
			t.Fatal("unknown campaign should be rejected")
		}
	})
}
