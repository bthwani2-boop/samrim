package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestOperatorStageAttentionIgnoresUnrelatedUpdatedAt(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL required for isolated stage attention proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('stage_ops_city','صنعاء',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "stage_ops_store", PartnerActorID: "stage_ops_partner", Name: "متجر المراحل"})
		now := time.Now().UTC().Truncate(time.Second)
		oldStage := now.Add(-90 * time.Minute)
		freshStage := now.Add(-5 * time.Minute)
		items := []struct {
			id    string
			stage *time.Time
		}{
			{"stage_ops_old", &oldStage}, {"stage_ops_fresh", &freshStage}, {"stage_ops_unknown", nil},
		}
		for _, item := range items {
			cartID := "cart_" + item.id
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'stage_ops_customer','stage_ops_store','checked_out',1)", cartID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version,created_at,updated_at)
                VALUES($1,'stage_ops_customer','stage_ops_store',$2,$3,1,'عنوان',15.36,44.19,'stage_ops_city','CITY_SCOPE_V1','SERVICEABLE',1,1,'PREPARING',1800,1800,'YER',2,$4,$5)`,
				item.id, cartID, "address_"+item.id, now.Add(-120*time.Minute), now); err != nil {
				t.Fatal(err)
			}
			if item.stage != nil {
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at)
                 VALUES('order_preparing',$1,$2,'stage_ops_partner',$3,'PARTNER_ACCEPTED','PREPARING',1,2,'stage-change',$4)`,
					"stage-idem-"+item.id, "stage-corr-"+item.id, item.id, *item.stage); err != nil {
					t.Fatal(err)
				}
			}
		}
		page, err := postgres.ListOrdersForOperator(ctx, db, "PREPARING", "", "updated_desc", true, 10, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Operations) != 2 || page.Summary.TotalCount != 2 || page.Summary.ActionableCount != 2 {
			t.Fatalf("stage attention must include stale stage and missing audit, not just updatedAt: %+v", page)
		}
		found := map[string]*time.Time{}
		for _, item := range page.Operations {
			found[item.OrderID] = item.StageStartedAt
		}
		if at, ok := found["stage_ops_old"]; !ok || at == nil || !at.Equal(oldStage) {
			t.Fatalf("old stage lost its owner timestamp: %+v", found)
		}
		if at, ok := found["stage_ops_unknown"]; !ok || at != nil {
			t.Fatalf("unknown stage should require review without fake timestamp: %+v", found)
		}
		if _, ok := found["stage_ops_fresh"]; ok {
			t.Fatalf("fresh stage was incorrectly queued: %+v", found)
		}
		all, err := postgres.ListOrdersForOperator(ctx, db, "PREPARING", "", "updated_desc", false, 10, "")
		if err != nil || len(all.Operations) != 3 || all.Summary.TotalCount != 3 || all.Summary.ActionableCount != 2 {
			t.Fatalf("full registry or summary mismatched stage-based attention: %+v err=%v", all, err)
		}
		seenFresh := false
		for _, item := range all.Operations {
			if item.OrderID == "stage_ops_fresh" && item.StageStartedAt != nil && item.StageStartedAt.Equal(freshStage) {
				seenFresh = true
			}
		}
		if !seenFresh {
			t.Fatal(fmt.Sprintf("fresh event timestamp not returned in canonical registry: %+v", all.Operations))
		}
	})
}
