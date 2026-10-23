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
)

func TestOperatorExceptionDetectionAuditedStagesAndReplay(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("isolated Postgres required")
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
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('auto_ops_city','Sanaa',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "auto_ops_store", PartnerActorID: "auto_ops_partner", Name: "Operations detector Store"})
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.store_operational_availability
  (store_id,preparation_minutes,updated_by_actor_id) VALUES('auto_ops_store',30,'auto_ops_partner')`); err != nil {
			t.Fatal(err)
		}
		old := time.Now().UTC().Add(-90 * time.Minute)
		fresh := time.Now().UTC().Add(-5 * time.Minute)
		recent := time.Now().UTC().Add(-time.Minute)
		for _, item := range []struct {
			id, state string
			event     *time.Time
		}{
			{"auto_ops_late", "PREPARING", &old},
			{"auto_ops_dispatch_late", "READY_FOR_DISPATCH", &old},
			{"auto_ops_dispatch_offered", "READY_FOR_DISPATCH", &old},
			{"auto_ops_dispatch_fresh", "READY_FOR_DISPATCH", &recent},
			{"auto_ops_dispatch_missing", "READY_FOR_DISPATCH", nil},
			{"auto_ops_accepted_late", "PARTNER_ACCEPTED", &old},
			{"auto_ops_accepted_fresh", "PARTNER_ACCEPTED", &fresh},
			{"auto_ops_accepted_missing", "PARTNER_ACCEPTED", nil},
			{"auto_ops_created_late", "CREATED", &old},
			{"auto_ops_created_fresh", "CREATED", &fresh},
			{"auto_ops_created_missing", "CREATED", nil},
			{"auto_ops_fresh", "PREPARING", &fresh},
			{"auto_ops_missing", "PREPARING", nil},
			{"auto_ops_failed", "DELIVERY_FAILED", &fresh},
		} {
			cartID := "cart_" + item.id
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version)
      VALUES($1,'auto_ops_client','auto_ops_store','checked_out',1)`, cartID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders
      (id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
      service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,
      serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version)
      VALUES($1,'auto_ops_client','auto_ops_store',$2,$3,1,'Sanaa',15.37,44.19,
      'auto_ops_city','CITY_SCOPE_V1','SERVICEABLE',1,1,$4,1000,1000,'YER',2)`,
				item.id, cartID, "address_"+item.id, item.state); err != nil {
				t.Fatal(err)
			}
			if item.event == nil {
				continue
			}
			if item.state == "PREPARING" {
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit
      (event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,
       from_version,result_version,request_hash,created_at)
      VALUES('order_preparing',$1,$2,'auto_ops_partner',$3,'PARTNER_ACCEPTED','PREPARING',1,2,'audit',$4)`,
					"auto-prep-idem-"+item.id, "auto-prep-corr-"+item.id, item.id, *item.event); err != nil {
					t.Fatal(err)
				}
			} else if item.state == "READY_FOR_DISPATCH" {
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit
      (event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,
       from_version,result_version,request_hash,created_at)
      VALUES('order_ready_for_dispatch',$1,$2,'auto_ops_partner',$3,'PREPARING','READY_FOR_DISPATCH',1,2,'audit',$4)`,
					"auto-dispatch-idem-"+item.id, "auto-dispatch-corr-"+item.id, item.id, *item.event); err != nil {
					t.Fatal(err)
				}
				if item.id == "auto_ops_dispatch_offered" {
					if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers
                      (id,order_id,captain_actor_id,state,expires_at,idempotency_key,request_hash)
                      VALUES('auto_dispatch_active_offer',$1,'auto_ops_offer_captain','offered',
                             clock_timestamp()+interval '15 minutes','auto_dispatch_offer_key','audit')`, item.id); err != nil {
						t.Fatal(err)
					}
				}
			} else if item.state == "PARTNER_ACCEPTED" {
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit
      (event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,
       from_version,result_version,request_hash,created_at)
      VALUES('order_partner_accepted',$1,$2,'auto_ops_partner',$3,'CREATED','PARTNER_ACCEPTED',1,2,'audit',$4)`,
					"auto-accepted-idem-"+item.id, "auto-accepted-corr-"+item.id, item.id, *item.event); err != nil {
					t.Fatal(err)
				}
			} else if item.state == "CREATED" {
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit
      (event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,
       from_version,result_version,request_hash,created_at)
      VALUES('order_created',$1,$2,'auto_ops_client',$3,NULL,'CREATED',NULL,1,'audit',$4)`,
					"auto-created-idem-"+item.id, "auto-created-corr-"+item.id, item.id, *item.event); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := db.ExecContext(ctx, `INSERT INTO dsh.captain_audit
      (event_type,idempotency_key,correlation_id,acting_actor_id,order_id,to_state,
       result_version,request_hash,created_at)
      VALUES('delivery_failed',$1,$2,'auto_ops_captain',$3,'delivery_failed',2,'audit',$4)`,
					"auto-fail-idem-"+item.id, "auto-fail-corr-"+item.id, item.id, *item.event); err != nil {
					t.Fatal(err)
				}
			}
		}
		if _, err := postgres.DetectOperatorOrderExceptions(ctx, db, 0); !errors.Is(err, postgres.ErrOpsCaseInvalid) {
			t.Fatalf("unbounded detector accepted: %v", err)
		}
		result := make(chan struct {
			count int64
			err   error
		}, 2)
		for i := 0; i < 2; i++ {
			go func() {
				n, scanErr := postgres.DetectOperatorOrderExceptions(ctx, db, 25)
				result <- struct {
					count int64
					err   error
				}{n, scanErr}
			}()
		}
		a, b := <-result, <-result
		if a.err != nil || b.err != nil || a.count+b.count != 5 {
			t.Fatalf("concurrent scan opened duplicates: a=%+v b=%+v", a, b)
		}
		again, err := postgres.DetectOperatorOrderExceptions(ctx, db, 25)
		if err != nil || again != 0 {
			t.Fatalf("same stage opened twice: count=%d err=%v", again, err)
		}
		cases, err := postgres.ListOpenOpsCases(ctx, db, "auto_ops_operator", "all", 20, "")
		if err != nil || len(cases.Items) != 5 {
			t.Fatalf("case inbox expected 2: %+v err=%v", cases, err)
		}
		var delay postgres.OpsCase
		createdDetected := false
		acceptedDetected := false
		dispatchDetected := false
		for _, c := range cases.Items {
			if c.OwnerActorID != nil || c.State != "OPEN" || c.Priority != "URGENT" {
				t.Fatalf("automatic case ownership or urgency wrong: %+v", c)
			}
			if c.OrderID == "auto_ops_dispatch_late" {
				dispatchDetected = true
				if c.Reason != "DISPATCH_UNAVAILABLE" || c.State != "OPEN" {
					t.Fatalf("dispatch delay produced the wrong case: %+v", c)
				}
			}
			if c.OrderID == "auto_ops_accepted_late" {
				acceptedDetected = true
				if c.Reason != "PARTNER_DELAY" || !strings.Contains(c.NextAction, "المتجر") {
					t.Fatalf("Accepted stage must name partner followup: %+v", c)
				}
			}
			if c.OrderID == "auto_ops_created_late" {
				createdDetected = true
				if c.Reason != "OTHER" || !strings.Contains(c.NextAction, "الدفع") {
					t.Fatalf("CREATED case must check payment without blaming Store: %+v", c)
				}
			}
			if c.OrderID == "auto_ops_late" {
				if c.Reason != "PARTNER_DELAY" {
					t.Fatalf("late prep reason: %+v", c)
				}
				delay = c
			}
			if c.OrderID == "auto_ops_failed" && c.Reason != "DELIVERY_BLOCKED" {
				t.Fatalf("delivery failure reason: %+v", c)
			}
		}
		if !dispatchDetected {
			t.Fatalf("audited READY_FOR_DISPATCH delay was missed")
		}
		if !acceptedDetected {
			t.Fatalf("audited PARTNER_ACCEPTED delay not detected")
		}
		if !createdDetected {
			t.Fatalf("audited CREATED delay was not detected")
		}
		if delay.ID <= 0 {
			t.Fatalf("audited PREPARING was not detected: %+v", cases)
		}
		claimed, _, err := postgres.UpdateOpsCase(ctx, db, delay.OrderID, delay.ID, "auto_ops_operator", "CLAIM", "", "auto-detector-claim-key", "auto-detector-claim-corr", 1)
		if err != nil || claimed.State != "IN_PROGRESS" {
			t.Fatalf("claim detector case: %+v err=%v", claimed, err)
		}
		closed, _, err := postgres.UpdateOpsCase(ctx, db, delay.OrderID, delay.ID, "auto_ops_operator", "RESOLVE",
			"Partner called and resolution documented", "auto-detector-resolve-key", "auto-detector-resolve-corr", 2)
		if err != nil || closed.State != "RESOLVED" {
			t.Fatalf("resolve detector case: %+v err=%v", closed, err)
		}
		again, err = postgres.DetectOperatorOrderExceptions(ctx, db, 25)
		if err != nil || again != 0 {
			t.Fatalf("resolved occurrence automatically reopened: count=%d err=%v", again, err)
		}
		var total, auditCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.operator_order_cases WHERE opened_by_actor_id='dsh:operations-detector'").Scan(&total); err != nil || total != 5 {
			t.Fatalf("detector case count=%d err=%v", total, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.operator_order_case_events WHERE actor_id='dsh:operations-detector' AND action='OPEN'").Scan(&auditCount); err != nil || auditCount != 5 {
			t.Fatalf("detector events missing/duplicate: %d err=%v", auditCount, err)
		}
		for _, item := range []struct{ id, state string }{{"auto_ops_late", "PREPARING"}, {"auto_ops_created_late", "CREATED"}, {"auto_ops_accepted_late", "PARTNER_ACCEPTED"}, {"auto_ops_dispatch_late", "READY_FOR_DISPATCH"}, {"auto_ops_failed", "DELIVERY_FAILED"}} {
			var state string
			if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.commerce_orders WHERE id=$1", item.id).Scan(&state); err != nil || state != item.state {
				t.Fatalf("detector changed canonical order state: %s %s err=%v", item.id, state, err)
			}
		}
	})
}
