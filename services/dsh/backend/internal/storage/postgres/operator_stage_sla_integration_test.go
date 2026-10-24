package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"os"
	"strings"
	"testing"
	"time"
)

func TestOperatorStageSLAEffectivePolicyAndMissingEvidence(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
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
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('sla157_city','Sanaa',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "sla157_store", PartnerActorID: "sla157_partner", Name: "SLA stage store"})
		now := time.Now().UTC().Truncate(time.Second)
		stageStart := now.Add(-50 * time.Minute)
		beforeStart := stageStart.Add(-10 * time.Minute)
		afterStart := stageStart.Add(5 * time.Minute)
		for _, tc := range []struct {
			id, state string
			audited   bool
		}{
			{"sla157_risk", "PREPARING", true},
			{"sla157_unconfigured", "READY_FOR_DISPATCH", true},
			{"sla157_missing", "PREPARING", false},
		} {
			cart := "cart_" + tc.id
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,'sla157_client','sla157_store','checked_out',1)", cart); err != nil {
				t.Fatal(err)
			}
			q := "INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version,updated_at) " +
				"VALUES($1,'sla157_client','sla157_store',$2,$3,1,'Sanaa',15.36,44.19,'sla157_city','CITY_SCOPE_V1','SERVICEABLE',1,1,$4,2000,2000,'YER',2,$5)"
			if _, err := db.ExecContext(ctx, q, tc.id, cart, "address_"+tc.id, tc.state, now); err != nil {
				t.Fatal(err)
			}
			if tc.audited {
				evt := "order_preparing"
				if tc.state == "READY_FOR_DISPATCH" {
					evt = "order_ready_for_dispatch"
				}
				audit := "INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash,created_at) " +
					"VALUES($1,$2,$3,'sla157_partner',$4,'PARTNER_ACCEPTED',$5,1,2,'sla157-proof',$6)"
				if _, err := db.ExecContext(ctx, audit, evt, fmt.Sprintf("sla157_%s", tc.id), fmt.Sprintf("sla157-corr-%s", tc.id), tc.id, tc.state, stageStart); err != nil {
					t.Fatal(err)
				}
			}
		}
		policy := "INSERT INTO dsh.operator_stage_sla_policies(fulfillment_mode,stage,target_minutes,warning_minutes,policy_version,effective_at,approved_by_actor_id) " +
			"VALUES ('BTHWANI_CAPTAIN','PREPARING',$1,$2,$3,$4,'sla_policy_approver')"
		if _, err := db.ExecContext(ctx, policy, 60, 15, 1, beforeStart); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, policy, 20, 5, 2, afterStart); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.operator_stage_sla_policies SET target_minutes=3 WHERE policy_version=1"); err == nil {
			t.Fatal("immutable SLA policy was changed")
		}
		result, err := postgres.ListOrdersForOperator(ctx, db, "", "", "updated_desc", false, 20, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Operations) != 3 {
			t.Fatalf("operations=%d", len(result.Operations))
		}
		byID := map[string]postgres.OperatorOperationListRecord{}
		for _, o := range result.Operations {
			byID[o.OrderID] = o
		}
		risk := byID["sla157_risk"]
		if risk.StageSLA.Status != "AT_RISK" || risk.StageSLA.PolicyVersion != 1 || risk.StageSLA.TargetMinutes != 60 || risk.StageSLA.DeadlineAt == nil || !risk.StageSLA.DeadlineAt.Equal(stageStart.Add(60*time.Minute)) {
			t.Fatalf("incorrect effective SLA %+v", risk.StageSLA)
		}
		if other := byID["sla157_unconfigured"].StageSLA; other.Status != "UNCONFIGURED" || other.DeadlineAt != nil {
			t.Fatalf("fabricated deadline %+v", other)
		}
		if other := byID["sla157_missing"].StageSLA; other.Status != "MISSING_EVENT" || other.DeadlineAt != nil {
			t.Fatalf("fabricated missing-event deadline %+v", other)
		}
		if result.Summary.TotalCount != 3 {
			t.Fatalf("incorrect unfiltered summary %+v", result.Summary)
		}
		attention, err := postgres.ListOrdersForOperator(ctx, db, "", "", "updated_desc", true, 20, "")
		if err != nil || len(attention.Operations) != 3 || attention.Summary.ActionableCount != 3 {
			t.Fatalf("server-side SLA attention filter does not match certified policy: %+v err=%v", attention, err)
		}
	})
}
