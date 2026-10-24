package postgres_test

import (
	"context"
	"database/sql"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"os"
	"strings"
	"testing"
	"time"
)

func TestOperatorDetectorRespectsStageEffectiveApprovedSLA(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('sla_detect_city','Sanaa',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "sla_detect_store", PartnerActorID: "sla_detect_partner", Name: "SLA detection proof"})
		now := time.Now().UTC().Truncate(time.Second)
		insertPolicy := "INSERT INTO dsh.operator_stage_sla_policies(fulfillment_mode,stage,target_minutes,warning_minutes,policy_version,effective_at,approved_by_actor_id) VALUES('BTHWANI_CAPTAIN','PREPARING',$1,5,$2,$3,'sla_operator')"
		if _, err := db.ExecContext(ctx, insertPolicy, 60, 1, now.Add(-90*time.Minute)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, insertPolicy, 10, 2, now.Add(-30*time.Minute)); err != nil {
			t.Fatal(err)
		}
		for _, item := range []struct {
			id      string
			minutes int
		}{
			{"sla_detect_old_policy", -40}, {"sla_detect_due", -18}, {"sla_detect_fresh", -5},
		} {
			start := now.Add(time.Duration(item.minutes) * time.Minute)
			cart := "cart_" + item.id
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'sla_client','sla_detect_store','checked_out',1)", cart); err != nil {
				t.Fatal(err)
			}
			query := "INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version,updated_at) " +
				"VALUES($1,'sla_client','sla_detect_store',$2,$3,1,'Sanaa',15.36,44.19,'sla_detect_city','CITY_SCOPE_V1','SERVICEABLE',1,1,'PREPARING',1000,1000,'YER',2,$4)"
			if _, err := db.ExecContext(ctx, query, item.id, cart, "address_"+item.id, now); err != nil {
				t.Fatal(err)
			}
			audit := "INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at) " +
				"VALUES('order_preparing',$1,$2,'sla_detect_partner',$3,'PARTNER_ACCEPTED','PREPARING',1,2,'sla_detect_audit',$4)"
			if _, err := db.ExecContext(ctx, audit, "idem-"+item.id, "corr-"+item.id, item.id, start); err != nil {
				t.Fatal(err)
			}
		}
		opened, err := postgres.DetectOperatorOrderExceptions(ctx, db, 30)
		if err != nil || opened != 1 {
			t.Fatalf("approved deadline detector: opened=%d err=%v", opened, err)
		}
		page, err := postgres.ListOpenOpsCases(ctx, db, "sla_operator", "all", 20, "")
		if err != nil || len(page.Items) != 1 || page.Items[0].OrderID != "sla_detect_due" || page.Items[0].Priority != "NORMAL" {
			t.Fatalf("incorrect stage-effective alert %+v err=%v", page, err)
		}
		again, err := postgres.DetectOperatorOrderExceptions(ctx, db, 30)
		if err != nil || again != 0 {
			t.Fatalf("duplicate stage alert %d %v", again, err)
		}
	})
}
