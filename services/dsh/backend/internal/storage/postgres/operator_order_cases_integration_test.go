package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestOperatorOrderCaseWorkflowAndIdempotency(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated Postgres required")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('ops_case_city','Sanaa',true)"); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "ops_case_store", PartnerActorID: "ops_case_partner", Name: "Operational Store"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('ops_case_cart','ops_case_customer','ops_case_store','checked_out',1)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version)
  VALUES('ops_case_order','ops_case_customer','ops_case_store','ops_case_cart','ops_case_address',1,'Sanaa',15.37,44.19,'ops_case_city','CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1100,1100,'YER',1)`); err != nil {
			t.Fatal(err)
		}
		current, replay, err := postgres.OpenOpsCase(ctx, db, "ops_case_order", "ops_one", "DISPATCH_UNAVAILABLE", "URGENT", "Find another eligible captain", "ops-case-open-1", "ops-case-corr-1")
		if err != nil || replay || current.State != "OPEN" || current.Version != 1 || current.ID <= 0 {
			t.Fatalf("open: %+v replay=%v err=%v", current, replay, err)
		}
		repeat, replay, err := postgres.OpenOpsCase(ctx, db, "ops_case_order", "ops_one", "DISPATCH_UNAVAILABLE", "URGENT", "Find another eligible captain", "ops-case-open-1", "ops-case-corr-1")
		if err != nil || !replay || repeat.ID != current.ID {
			t.Fatalf("open replay: %+v replay=%v err=%v", repeat, replay, err)
		}
		_, _, err = postgres.OpenOpsCase(ctx, db, "ops_case_order", "ops_one", "DISPATCH_UNAVAILABLE", "NORMAL", "Find another eligible captain", "ops-case-open-1", "ops-case-corr-1")
		if !errors.Is(err, postgres.ErrOpsCaseIdempotency) {
			t.Fatalf("reused key with changed priority: %v", err)
		}
		_, _, err = postgres.OpenOpsCase(ctx, db, "ops_case_order", "ops_two", "DISPATCH_UNAVAILABLE", "URGENT", "Find another eligible captain", "ops-case-open-2", "ops-case-corr-2")
		if !errors.Is(err, postgres.ErrOpsCaseConflict) {
			t.Fatalf("duplicate active case: %v", err)
		}
		listed, err := postgres.ListOrderOpsCases(ctx, db, "ops_case_order", 15, "")
		if err != nil || len(listed.Items) != 1 || listed.Items[0].ID != current.ID {
			t.Fatalf("list: %+v err=%v", listed, err)
		}
		_, err = postgres.ListOrderOpsCases(ctx, db, "ops_case_order", 15, "badCursor")
		if !errors.Is(err, postgres.ErrOpsCaseInvalid) {
			t.Fatalf("bad cursor accepted: %v", err)
		}
		_, _, err = postgres.UpdateOpsCase(ctx, db, "ops_case_order", current.ID, "ops_one", "RESOLVE", "No decision required yet", "ops-case-before-claim", "ops-case-corr-3", 1)
		if !errors.Is(err, postgres.ErrOpsCaseForbidden) {
			t.Fatalf("unclaimed close: %v", err)
		}
		claimed, replay, err := postgres.UpdateOpsCase(ctx, db, "ops_case_order", current.ID, "ops_one", "CLAIM", "", "ops-case-claim-1", "ops-case-corr-4", 1)
		if err != nil || replay || claimed.Version != 2 || claimed.OwnerActorID == nil || *claimed.OwnerActorID != "ops_one" {
			t.Fatalf("claim: %+v replay=%v err=%v", claimed, replay, err)
		}
		_, replay, err = postgres.UpdateOpsCase(ctx, db, "ops_case_order", current.ID, "ops_one", "CLAIM", "", "ops-case-claim-1", "ops-case-corr-4", 1)
		if err != nil || !replay {
			t.Fatalf("claim replay: replay=%v err=%v", replay, err)
		}
		_, _, err = postgres.UpdateOpsCase(ctx, db, "ops_case_order", current.ID, "ops_two", "RESOLVE", "Confirmed service restored", "ops-case-other-1", "ops-case-corr-5", 2)
		if !errors.Is(err, postgres.ErrOpsCaseForbidden) {
			t.Fatalf("other actor advanced case: %v", err)
		}
		_, _, err = postgres.UpdateOpsCase(ctx, db, "ops_case_order", current.ID, "ops_one", "ACTION_REQUIRED", "Please contact the store now", "ops-case-stale-1", "ops-case-corr-6", 1)
		if !errors.Is(err, postgres.ErrOpsCaseConflict) {
			t.Fatalf("stale action: %v", err)
		}
		action, replay, err := postgres.UpdateOpsCase(ctx, db, "ops_case_order", current.ID, "ops_one", "ACTION_REQUIRED", "Please contact the store now", "ops-case-action-1", "ops-case-corr-7", 2)
		if err != nil || replay || action.Version != 3 || action.State != "ACTION_REQUIRED" {
			t.Fatalf("set next action: %+v err=%v", action, err)
		}
		done, replay, err := postgres.UpdateOpsCase(ctx, db, "ops_case_order", current.ID, "ops_one", "RESOLVE", "Dispatch restored and assignment rechecked", "ops-case-close-1", "ops-case-corr-8", 3)
		if err != nil || replay || done.State != "RESOLVED" || done.ResolvedAt == nil || done.Version != 4 {
			t.Fatalf("resolve: %+v err=%v", done, err)
		}
		_, _, err = postgres.UpdateOpsCase(ctx, db, "ops_case_order", current.ID, "ops_one", "RESOLVE", "Repeat resolution", "ops-case-close-2", "ops-case-corr-9", 4)
		if !errors.Is(err, postgres.ErrOpsCaseConflict) {
			t.Fatalf("resolved case modified: %v", err)
		}
		newer, _, err := postgres.OpenOpsCase(ctx, db, "ops_case_order", "ops_one", "DISPATCH_UNAVAILABLE", "NORMAL", "New dispatch escalation after resolution", "ops-case-open-new", "ops-case-corr-10")
		if err != nil || newer.ID == current.ID {
			t.Fatalf("new occurrence after resolution: %+v err=%v", newer, err)
		}
		page, err := postgres.ListOrderOpsCases(ctx, db, "ops_case_order", 1, "")
		if err != nil || len(page.Items) != 1 || page.NextCursor == "" || page.Items[0].ID != newer.ID {
			t.Fatalf("page: %+v err=%v", page, err)
		}
		next, err := postgres.ListOrderOpsCases(ctx, db, "ops_case_order", 1, page.NextCursor)
		if err != nil || len(next.Items) != 1 || next.Items[0].ID != current.ID || next.NextCursor != "" {
			t.Fatalf("page2: %+v err=%v", next, err)
		}
		// Two operators report the same occurrence concurrently. The order
		// row lock must serialize both attempts; only one open case survives.
		results := make(chan error, 2)
		for _, operator := range []string{"ops_alpha", "ops_beta"} {
			actor := operator
			go func() {
				_, _, openErr := postgres.OpenOpsCase(ctx, db, "ops_case_order", actor, "OTHER", "NORMAL",
					"Investigate duplicate incident reports", "case-concurrent-"+actor, "corr-concurrent-"+actor)
				results <- openErr
			}()
		}
		firstErr, secondErr := <-results, <-results
		accepted, rejected := 0, 0
		for _, candidate := range []error{firstErr, secondErr} {
			if candidate == nil {
				accepted++
			} else if errors.Is(candidate, postgres.ErrOpsCaseConflict) {
				rejected++
			} else {
				t.Fatalf("unexpected concurrency error: %v", candidate)
			}
		}
		if accepted != 1 || rejected != 1 {
			t.Fatalf("duplicate open race accepted=%d conflict=%d", accepted, rejected)
		}
		var activeCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.operator_order_cases WHERE order_id='ops_case_order' AND reason='OTHER' AND state<>'RESOLVED'").Scan(&activeCount); err != nil || activeCount != 1 {
			t.Fatalf("concurrent operations created duplicate: count=%d err=%v", activeCount, err)
		}
		urgent, _, err := postgres.OpenOpsCase(ctx, db, "ops_case_order", "ops_one", "CUSTOMER_CONTACT", "URGENT",
			"Call customer and confirm delivery outcome", "ops-inbox-urgent-open", "ops-inbox-urgent-corr")
		if err != nil {
			t.Fatalf("inbox urgent fixture: %v", err)
		}
		owned, _, err := postgres.UpdateOpsCase(ctx, db, "ops_case_order", urgent.ID, "ops_one", "CLAIM", "",
			"ops-inbox-urgent-claim", "ops-inbox-urgent-claim-corr", 1)
		if err != nil || owned.OwnerActorID == nil || *owned.OwnerActorID != "ops_one" {
			t.Fatalf("inbox owner fixture: %+v err=%v", owned, err)
		}
		inbox, err := postgres.ListOpenOpsCases(ctx, db, "ops_one", "all", 1, "")
		if err != nil || len(inbox.Items) != 1 || inbox.Items[0].ID != urgent.ID || inbox.NextCursor == "" {
			t.Fatalf("urgency-first inbox incorrect: %+v err=%v", inbox, err)
		}
		later, err := postgres.ListOpenOpsCases(ctx, db, "ops_one", "all", 1, inbox.NextCursor)
		if err != nil || len(later.Items) != 1 || later.Items[0].Priority != "NORMAL" || later.Items[0].ID == urgent.ID {
			t.Fatalf("second priority page incorrect: %+v err=%v", later, err)
		}
		mine, err := postgres.ListOpenOpsCases(ctx, db, "ops_one", "mine", 30, "")
		if err != nil || len(mine.Items) != 1 || mine.Items[0].ID != urgent.ID {
			t.Fatalf("mine scope leaked/unassigned cases: %+v err=%v", mine, err)
		}
		notMine, err := postgres.ListOpenOpsCases(ctx, db, "ops_two", "mine", 30, "")
		if err != nil || len(notMine.Items) != 0 {
			t.Fatalf("other actor sees another's case: %+v err=%v", notMine, err)
		}
		unassigned, err := postgres.ListOpenOpsCases(ctx, db, "ops_one", "unassigned", 30, "")
		if err != nil || len(unassigned.Items) != 2 {
			t.Fatalf("unassigned inbox should include two active cases: %+v err=%v", unassigned, err)
		}
		if _, err := postgres.ListOpenOpsCases(ctx, db, "ops_one", "all", 10, "not-a-cursor"); !errors.Is(err, postgres.ErrOpsCaseInvalid) {
			t.Fatalf("invalid priority cursor allowed: %v", err)
		}
		if _, err := postgres.ListOpenOpsCases(ctx, db, "ops_one", "someone-else", 10, ""); !errors.Is(err, postgres.ErrOpsCaseInvalid) {
			t.Fatalf("invalid scope accepted: %v", err)
		}
		events, err := postgres.ListOrderOpsCaseEvents(ctx, db, "ops_case_order", current.ID, 2, "")
		if err != nil || len(events.Items) != 2 || events.NextCursor == "" || events.Items[0].Action != "RESOLVE" ||
			events.Items[0].ActorID != "ops_one" || events.Items[0].Detail == "" {
			t.Fatalf("case audit first page: %+v err=%v", events, err)
		}
		secondEvents, err := postgres.ListOrderOpsCaseEvents(ctx, db, "ops_case_order", current.ID, 2, events.NextCursor)
		if err != nil || len(secondEvents.Items) != 2 || secondEvents.NextCursor != "" ||
			secondEvents.Items[1].Action != "OPEN" {
			t.Fatalf("case audit second page: %+v err=%v", secondEvents, err)
		}
		if _, err := postgres.ListOrderOpsCaseEvents(ctx, db, "another_order", current.ID, 20, ""); !errors.Is(err, postgres.ErrOpsCaseNotFound) {
			t.Fatalf("cross-order case audit disclosed: %v", err)
		}
		if _, err := postgres.ListOrderOpsCaseEvents(ctx, db, "ops_case_order", current.ID, 20, "invalid"); !errors.Is(err, postgres.ErrOpsCaseInvalid) {
			t.Fatalf("invalid case audit cursor accepted: %v", err)
		}
		if _, err := postgres.ListOrderOpsCaseEvents(ctx, db, "ops_case_order", current.ID, 31, ""); !errors.Is(err, postgres.ErrOpsCaseInvalid) {
			t.Fatalf("unbounded case event paging accepted: %v", err)
		}
		encoded, err := json.Marshal(events)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{"idempotencyKey", "requestHash", "correlationId"} {
			if strings.Contains(string(encoded), secret) {
				t.Fatalf("case audit response exposed %s", secret)
			}
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.operator_order_case_events WHERE case_id=$1", current.ID).Scan(&count); err != nil || count != 4 {
			t.Fatalf("audit count=%d err=%v", count, err)
		}
	})
}
