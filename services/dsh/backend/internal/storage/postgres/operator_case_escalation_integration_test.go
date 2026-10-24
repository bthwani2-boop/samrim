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

func TestOperatorCaseUnclaimedEscalationIsAuditedAndBounded(t *testing.T) {
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
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('ops_escalation_city','Sanaa',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "ops_escalation_store", PartnerActorID: "ops_escalation_partner", Name: "Escalation Store"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('ops_escalation_cart','ops_escalation_customer','ops_escalation_store','checked_out',1)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version)
  VALUES('ops_escalation_order','ops_escalation_customer','ops_escalation_store','ops_escalation_cart','ops_escalation_address',1,'Sanaa',15.37,44.19,'ops_escalation_city','CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1200,1200,'YER',1)`); err != nil {
			t.Fatal(err)
		}
		old, _, err := postgres.OpenOpsCase(ctx, db, "ops_escalation_order", "ops_employee", "PARTNER_DELAY", "NORMAL", "Please contact partner to resolve delay", "esc-case-open-old", "esc-case-corr-old")
		if err != nil {
			t.Fatal(err)
		}
		fresh, _, err := postgres.OpenOpsCase(ctx, db, "ops_escalation_order", "ops_employee", "OTHER", "NORMAL", "Follow the new customer request", "esc-case-open-new", "esc-case-corr-new")
		if err != nil {
			t.Fatal(err)
		}
		urgent, _, err := postgres.OpenOpsCase(ctx, db, "ops_escalation_order", "ops_employee", "DELIVERY_BLOCKED", "URGENT", "Resolve delivery handover safely", "esc-case-open-urgent", "esc-case-corr-urgent")
		if err != nil {
			t.Fatal(err)
		}
		owned, _, err := postgres.OpenOpsCase(ctx, db, "ops_escalation_order", "ops_employee", "CUSTOMER_CONTACT", "NORMAL", "Contact client for review and confirmation", "esc-case-open-owned", "esc-case-corr-owned")
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := postgres.UpdateOpsCase(ctx, db, owned.OrderID, owned.ID, "ops_employee", "CLAIM", "", "esc-case-claim-owned", "esc-case-claim-corr", 1); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.operator_order_cases SET opened_at=clock_timestamp()-interval '45 minutes'
     WHERE id IN ($1,$2,$3)`, old.ID, urgent.ID, owned.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.EscalateUnclaimedOperatorCases(ctx, db, 0, 30*time.Minute); !errors.Is(err, postgres.ErrOpsCaseInvalid) {
			t.Fatalf("zero limit accepted: %v", err)
		}
		if _, err := postgres.EscalateUnclaimedOperatorCases(ctx, db, 25, 0); !errors.Is(err, postgres.ErrOpsCaseInvalid) {
			t.Fatalf("zero age accepted: %v", err)
		}
		results := make(chan struct {
			n   int64
			err error
		}, 2)
		for i := 0; i < 2; i++ {
			go func() {
				count, scanErr := postgres.EscalateUnclaimedOperatorCases(ctx, db, 25, 30*time.Minute)
				results <- struct {
					n   int64
					err error
				}{count, scanErr}
			}()
		}
		a, b := <-results, <-results
		if a.err != nil || b.err != nil || a.n+b.n != 1 {
			t.Fatalf("duplicate escalation: a=%+v b=%+v", a, b)
		}
		again, err := postgres.EscalateUnclaimedOperatorCases(ctx, db, 25, 30*time.Minute)
		if err != nil || again != 0 {
			t.Fatalf("escalated case changed on replay count=%d err=%v", again, err)
		}
		after, err := postgres.ReadOpsCase(ctx, db, old.ID)
		if err != nil || after.State != "ACTION_REQUIRED" || after.Priority != "URGENT" || after.Version != 2 || after.OwnerActorID != nil || after.NextAction != old.NextAction {
			t.Fatalf("unassigned overdue case incorrectly advanced: %+v err=%v", after, err)
		}
		untouched, err := postgres.ReadOpsCase(ctx, db, fresh.ID)
		if err != nil || untouched.Version != 1 || untouched.Priority != "NORMAL" {
			t.Fatalf("fresh case escalated: %+v err=%v", untouched, err)
		}
		alreadyUrgent, err := postgres.ReadOpsCase(ctx, db, urgent.ID)
		if err != nil || alreadyUrgent.State != "OPEN" || alreadyUrgent.Version != 1 {
			t.Fatalf("urgent case duplicated escalation: %+v err=%v", alreadyUrgent, err)
		}
		claimed, err := postgres.ReadOpsCase(ctx, db, owned.ID)
		if err != nil || claimed.State != "IN_PROGRESS" || claimed.Priority != "NORMAL" || claimed.Version != 2 {
			t.Fatalf("claimed case escalated: %+v err=%v", claimed, err)
		}
		var eventCount int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.operator_order_case_events
     WHERE case_id=$1 AND action='ACTION_REQUIRED' AND actor_id='dsh:operations-detector'`, old.ID).Scan(&eventCount); err != nil || eventCount != 1 {
			t.Fatalf("escalation audit missing/duplicate: count=%d err=%v", eventCount, err)
		}
		taken, _, err := postgres.UpdateOpsCase(ctx, db, old.OrderID, old.ID, "ops_employee", "CLAIM", "", "esc-case-claim-escalated", "esc-case-claim-next", 2)
		if err != nil || taken.State != "IN_PROGRESS" || taken.OwnerActorID == nil {
			t.Fatalf("escalated case cannot be claimed: %+v err=%v", taken, err)
		}
		var orderState string
		if err := db.QueryRowContext(ctx, "SELECT state FROM dsh.commerce_orders WHERE id='ops_escalation_order'").Scan(&orderState); err != nil || orderState != "READY_FOR_DISPATCH" {
			t.Fatalf("escalation mutated canonical order: %s err=%v", orderState, err)
		}
	})
}
