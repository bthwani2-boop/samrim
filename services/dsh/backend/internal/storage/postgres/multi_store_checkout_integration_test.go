package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/lib/pq"
)

func TestMultiStoreCheckoutPersistsPartialOutcomesAndCancelReplay(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for multi-store checkout persistence proof")
	}

	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		const (
			cityID        = "multi-checkout-city"
			clientID      = "multi-checkout-client"
			otherClientID = "multi-checkout-other-client"
			firstStoreID  = "multi-checkout-store-one"
			secondStoreID = "multi-checkout-store-two"
			firstCartID   = "multi-checkout-cart-one"
			secondCartID  = "multi-checkout-cart-two"
			checkoutID    = "multi-checkout-parent"
			orderID       = "multi-checkout-order-one"
			createKey     = "multi-checkout-create-key"
			cancelKey     = "multi-checkout-cancel-key"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", cityID, "مدينة طلب متعدد"); err != nil {
			t.Fatalf("insert service city: %v", err)
		}
		for _, store := range []struct{ id, partner, name string }{
			{firstStoreID, "multi-checkout-partner-one", "متجر الطلب الأول"},
			{secondStoreID, "multi-checkout-partner-two", "متجر الطلب الثاني"},
		} {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store.id, PartnerActorID: store.partner, Name: store.name})
		}
		for _, cart := range []struct{ id, storeID string }{{firstCartID, firstStoreID}, {secondCartID, secondStoreID}} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cart.id, clientID, cart.storeID); err != nil {
				t.Fatalf("insert cart %s: %v", cart.id, err)
			}
		}

		// A second genuinely distinct Client owns two carts for the same public
		// Stores. This fixture is scoped to the disposable migrated DSH database.
		for _, cart := range []struct{ id, storeID string }{
			{"multi-checkout-other-cart-one", firstStoreID},
			{"multi-checkout-other-cart-two", secondStoreID},
		} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cart.id, otherClientID, cart.storeID); err != nil {
				t.Fatalf("insert other Client cart %s: %v", cart.id, err)
			}
		}

		input := postgres.MultiStoreCheckoutInput{ID: checkoutID, ClientActorID: clientID, Children: []postgres.MultiStoreCheckoutChildInput{
			{CartID: firstCartID, StoreID: firstStoreID, AddressID: "address-one", CartVersion: 1, ExpectedTotalAmountMinor: 1800, FulfillmentMode: "BTHWANI_CAPTAIN"},
			{CartID: secondCartID, StoreID: secondStoreID, AddressID: "address-two", CartVersion: 1, ExpectedTotalAmountMinor: 1800, FulfillmentMode: "BTHWANI_CAPTAIN"},
		}}
		requestHash := postgres.HashMultiStoreCheckoutRequest(input)
		// Simultaneous client submissions share one durable parent and two children.
		type createResult struct {
			checkout postgres.MultiStoreCheckoutRecord
			replayed bool
			err      error
		}
		const concurrentAttempts = 8
		results := make(chan createResult, concurrentAttempts)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for i := 0; i < concurrentAttempts; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				item, replay, e := postgres.CreateMultiStoreCheckout(ctx, db, input, createKey, requestHash)
				results <- createResult{item, replay, e}
			}()
		}
		close(start)
		wg.Wait()
		close(results)
		var checkout postgres.MultiStoreCheckoutRecord
		fresh, repeats := 0, 0
		for result := range results {
			if result.err != nil || result.checkout.State != "PROCESSING" || len(result.checkout.Children) != 2 || result.checkout.ID != checkoutID {
				t.Fatalf("concurrent checkout = %+v replay=%t err=%v", result.checkout, result.replayed, result.err)
			}
			checkout = result.checkout
			if result.replayed {
				repeats++
			} else {
				fresh++
			}
		}
		if fresh != 1 || repeats != concurrentAttempts-1 {
			t.Fatalf("checkout fresh=%d repeated=%d", fresh, repeats)
		}
		for _, countQuery := range []struct {
			query    string
			expected int
		}{
			{"SELECT count(*) FROM dsh.commerce_multi_store_checkouts WHERE id=$1", 1},
			{"SELECT count(*) FROM dsh.commerce_multi_store_checkout_children WHERE checkout_id=$1", 2},
		} {
			var count int
			if err := db.QueryRowContext(ctx, countQuery.query, checkoutID).Scan(&count); err != nil || count != countQuery.expected {
				t.Fatalf("duplicate checkout persisted count=%d want=%d err=%v", count, countQuery.expected, err)
			}
		}
		// Each count separately fits in child_count, but both together cannot exceed it.
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_multi_store_checkouts SET successful_child_count=child_count, failed_child_count=1 WHERE id=$1", checkoutID); err == nil {
			t.Fatal("overcounted multi-Store checkout was accepted by PostgreSQL")
		} else {
			var pgErr *pq.Error
			if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.Constraint != "commerce_multi_store_checkouts_total_count_chk" {
				t.Fatalf("overcounted checkout rejection = %v; want named SQL CHECK violation", err)
			}
		}
		var successfulCount, failedCount int
		if err := db.QueryRowContext(ctx, "SELECT successful_child_count,failed_child_count FROM dsh.commerce_multi_store_checkouts WHERE id=$1", checkoutID).Scan(&successfulCount, &failedCount); err != nil || successfulCount != 0 || failedCount != 0 {
			t.Fatalf("invalid count update changed persistent parent: success=%d failed=%d err=%v", successfulCount, failedCount, err)
		}
		var canonicalIndexExists, duplicateIndexExists bool
		if err := db.QueryRowContext(ctx, `SELECT to_regclass('dsh.commerce_multi_store_checkout_children_index_uq') IS NOT NULL,
			to_regclass('dsh.commerce_multi_store_checkout_children_checkout_idx') IS NOT NULL`).Scan(&canonicalIndexExists, &duplicateIndexExists); err != nil || !canonicalIndexExists || duplicateIndexExists {
			t.Fatalf("checkout child indexes: unique=%t redundant=%t err=%v", canonicalIndexExists, duplicateIndexExists, err)
		}
		replay, replayed, err := postgres.CreateMultiStoreCheckout(ctx, db, input, createKey, requestHash)
		if err != nil || !replayed || replay.ID != checkoutID || len(replay.Children) != 2 {
			t.Fatalf("same-key create replay = %+v replayed=%t err=%v", replay, replayed, err)
		}
		changed := input
		changed.Children = append([]postgres.MultiStoreCheckoutChildInput(nil), input.Children...)
		changed.Children[1].CartVersion++
		changedTotal := input
		changedTotal.Children = append([]postgres.MultiStoreCheckoutChildInput(nil), input.Children...)
		changedTotal.Children[1].ExpectedTotalAmountMinor++
		if _, _, err := postgres.CreateMultiStoreCheckout(ctx, db, changedTotal, createKey, postgres.HashMultiStoreCheckoutRequest(changedTotal)); !errors.Is(err, postgres.ErrMultiStoreCheckoutIdempotencyConflict) {
			t.Fatalf("different accepted amount same-key create = %v; want idempotency conflict", err)
		}
		if _, _, err := postgres.CreateMultiStoreCheckout(ctx, db, changed, createKey, postgres.HashMultiStoreCheckoutRequest(changed)); !errors.Is(err, postgres.ErrMultiStoreCheckoutIdempotencyConflict) {
			t.Fatalf("changed same-key create = %v; want idempotency conflict", err)
		}
		// Positive two-actor proof: B creates its own parent from its two
		// persisted carts, without acquiring A's private parent or replay.
		otherInput := postgres.MultiStoreCheckoutInput{
			ID: "multi-checkout-other-parent", ClientActorID: otherClientID,
			Children: []postgres.MultiStoreCheckoutChildInput{
				{CartID: "multi-checkout-other-cart-one", StoreID: firstStoreID, AddressID: "other-address-one", CartVersion: 1, ExpectedTotalAmountMinor: 1900, FulfillmentMode: "BTHWANI_CAPTAIN"},
				{CartID: "multi-checkout-other-cart-two", StoreID: secondStoreID, AddressID: "other-address-two", CartVersion: 1, ExpectedTotalAmountMinor: 1900, FulfillmentMode: "BTHWANI_CAPTAIN"},
			},
		}
		otherParent, otherReplay, err := postgres.CreateMultiStoreCheckout(ctx, db, otherInput, "other-client-create-key", postgres.HashMultiStoreCheckoutRequest(otherInput))
		if err != nil || otherReplay || otherParent.ClientActorID != otherClientID || len(otherParent.Children) != 2 {
			t.Fatalf("second Client two-cart parent = %+v replay=%t err=%v", otherParent, otherReplay, err)
		}
		if _, err := postgres.ReadMultiStoreCheckoutForClient(ctx, db, checkoutID, otherClientID); !errors.Is(err, postgres.ErrMultiStoreCheckoutNotFound) {
			t.Fatalf("Client B read Client A parent = %v; want not found", err)
		}
		if _, err := postgres.ReadMultiStoreCheckoutForClient(ctx, db, otherParent.ID, clientID); !errors.Is(err, postgres.ErrMultiStoreCheckoutNotFound) {
			t.Fatalf("Client A read Client B parent = %v; want not found", err)
		}
		otherReusingAKey := otherInput
		otherReusingAKey.ID = "other-client-reuse-attempt"
		if _, _, err := postgres.CreateMultiStoreCheckout(ctx, db, otherReusingAKey, createKey, postgres.HashMultiStoreCheckoutRequest(otherReusingAKey)); !errors.Is(err, postgres.ErrMultiStoreCheckoutIdempotencyConflict) {
			t.Fatalf("cross-client idempotency identity reused A's parent: %v", err)
		}
		otherReadback, err := postgres.ReadMultiStoreCheckoutForClient(ctx, db, otherParent.ID, otherClientID)
		if err != nil || otherReadback.ID != otherParent.ID || len(otherReadback.Children) != 2 {
			t.Fatalf("second Client canonical readback = %+v err=%v", otherReadback, err)
		}

		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
			VALUES($1,$2,$3,$4,$5,1,$6,15.3694457,44.1910064,$7,'CITY_SCOPE_V1','SERVICEABLE',1,1,'CREATED',1800,'YER',1,$8,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)`, orderID, clientID, firstStoreID, firstCartID, "address-one", "عنوان الطلب الأول", cityID, "multi-checkout-payment-one"); err != nil {
			t.Fatalf("insert canonical child order: %v", err)
		}
		partial, err := postgres.MarkMultiStoreCheckoutChildSucceeded(ctx, db, checkoutID, checkout.Children[0].ID, orderID)
		if err != nil || partial.State != "PROCESSING" || partial.SuccessfulChildCount != 1 || partial.FailedChildCount != 0 {
			t.Fatalf("first child success = %+v err=%v", partial, err)
		}
		partial, err = postgres.MarkMultiStoreCheckoutChildFailed(ctx, db, checkoutID, checkout.Children[1].ID, "STALE_CHECKOUT", "cart changed")
		if err != nil || partial.State != "PARTIAL_FAILURE" || partial.SuccessfulChildCount != 1 || partial.FailedChildCount != 1 {
			t.Fatalf("partial child failure = %+v err=%v", partial, err)
		}
		readback, err := postgres.ReadMultiStoreCheckoutForClient(ctx, db, checkoutID, clientID)
		if err != nil || readback.State != "PARTIAL_FAILURE" || readback.Children[0].OrderID != orderID || readback.Children[1].FailureCode != "STALE_CHECKOUT" {
			t.Fatalf("canonical parent/child readback = %+v err=%v", readback, err)
		}

		cancelHash := postgres.HashMultiStoreCheckoutCancelRequest(checkoutID, readback.Version)
		cancelAttempt, replayed, err := postgres.BeginMultiStoreCheckoutCancel(ctx, db, checkoutID, clientID, cancelKey, cancelHash, readback.Version)
		if err != nil || replayed || cancelAttempt.ID != checkoutID {
			t.Fatalf("begin parent cancel = %+v replayed=%t err=%v", cancelAttempt, replayed, err)
		}
		cancelled, err := postgres.MarkMultiStoreCheckoutChildCancelled(ctx, db, checkoutID, checkout.Children[0].ID)
		if err != nil || cancelled.State != "CANCELLED" || cancelled.FailedChildCount != 1 {
			t.Fatalf("cancel child/readback = %+v err=%v", cancelled, err)
		}
		if err := postgres.CompleteMultiStoreCheckoutMutation(ctx, db, cancelKey, cancelled.Version); err != nil {
			t.Fatalf("complete cancel idempotency readback: %v", err)
		}
		cancelReplay, replayed, err := postgres.BeginMultiStoreCheckoutCancel(ctx, db, checkoutID, clientID, cancelKey, cancelHash, readback.Version)
		if err != nil || !replayed || cancelReplay.State != "CANCELLED" {
			t.Fatalf("same-key cancel replay = %+v replayed=%t err=%v", cancelReplay, replayed, err)
		}
		var resultVersion int
		if err := db.QueryRowContext(ctx, "SELECT result_version FROM dsh.commerce_multi_store_checkout_idempotency WHERE idempotency_key=$1", cancelKey).Scan(&resultVersion); err != nil || resultVersion != cancelled.Version {
			t.Fatalf("cancel result version = %d err=%v; want %d", resultVersion, err, cancelled.Version)
		}
	})
}

func TestMultiStoreCheckoutMigrationUpgradesV177WithPersistedChildren(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated DSH_DATABASE_URL required for retained-data migration proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	checkCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := rootDB.PingContext(checkCtx); err != nil {
		t.Fatalf("configured isolated PostgreSQL is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		const previousVersion = 177
		if len(records) < 178 || records[previousVersion].Name != "178_multi_store_checkout_count_and_index.sql" {
			t.Fatalf("expected canonical v178 checkout migration after v177, got %d records", len(records))
		}
		// Reconstruct the last accepted DSH baseline inside this disposable
		// database only. The owning migrator performs the subsequent upgrade.
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.ExecContext(ctx, `CREATE TABLE dsh.schema_migrations (
			version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
			t.Fatal(err)
		}
		for index := 0; index < previousVersion; index++ {
			if _, err := tx.ExecContext(ctx, migrationSQL[index]); err != nil {
				t.Fatalf("bootstrap historical DSH v%d: %v", index+1, err)
			}
			record := records[index]
			if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version,name,sha256) VALUES($1,$2,$3)", record.Version, record.Name, record.SHA256); err != nil {
				t.Fatalf("record historical DSH v%d: %v", record.Version, err)
			}
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("commit historical DSH baseline: %v", err)
		}

		const (
			parentID = "checkout-upgrade-retained-parent"
			otherID  = "checkout-upgrade-reject-invalid-parent"
			clientID = "checkout-upgrade-client"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", "checkout-upgrade-city", "مدينة بيانات محفوظة"); err != nil {
			t.Fatal(err)
		}
		for _, storeID := range []string{"checkout-upgrade-store-a", "checkout-upgrade-store-b"} {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
				ID: storeID, PartnerActorID: "checkout-upgrade-partner-" + storeID,
				Name: "متجر محفوظ " + storeID,
			})
			cartID := "checkout-upgrade-cart-" + storeID
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_carts(
				id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)`,
				cartID, clientID, storeID); err != nil {
				t.Fatalf("insert persisted v177 cart: %v", err)
			}
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_multi_store_checkouts(
			id,client_actor_id,state,version,child_count,successful_child_count,failed_child_count)
			VALUES($1,$2,'PROCESSING',4,2,0,1)`, parentID, clientID); err != nil {
			t.Fatal(err)
		}
		for index, storeID := range []string{"checkout-upgrade-store-a", "checkout-upgrade-store-b"} {
			state := "PENDING"
			failureCode := ""
			if index == 0 {
				state, failureCode = "FAILED", "STALE_QUOTE"
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_multi_store_checkout_children(
				id,checkout_id,child_index,cart_id,store_id,address_id,cart_version,fulfillment_mode,state,failure_code)
				VALUES($1,$2,$3,$4,$5,$6,1,'BTHWANI_CAPTAIN',$7,NULLIF($8,''))`,
				"checkout-upgrade-child-"+storeID, parentID, index, "checkout-upgrade-cart-"+storeID, storeID,
				"checkout-upgrade-address-"+storeID, state, failureCode); err != nil {
				t.Fatalf("insert persisted v177 child %d: %v", index, err)
			}
		}
		// v177 permits this logically impossible sum; the forward migration
		// must fail closed rather than silently modifying retained rows.
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_multi_store_checkouts(
			id,client_actor_id,state,child_count,successful_child_count,failed_child_count)
			VALUES($1,$2,'PARTIAL_FAILURE',2,2,1)`, otherID, clientID); err != nil {
			t.Fatalf("prepare v177 overcounted parent: %v", err)
		}
		err = postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t))
		var constraintErr *pq.Error
		if !errors.As(err, &constraintErr) || constraintErr.Code != "23514" ||
			constraintErr.Constraint != "commerce_multi_store_checkouts_total_count_chk" {
			t.Fatalf("incompatible legacy data migration = %v; want named 23514 CHECK rejection", err)
		}
		var currentVersion int
		if err := db.QueryRowContext(ctx, "SELECT max(version) FROM dsh.schema_migrations").Scan(&currentVersion); err != nil || currentVersion != previousVersion {
			t.Fatalf("failed migration must not advance history: current=%d err=%v", currentVersion, err)
		}
		if _, err := db.ExecContext(ctx, "DELETE FROM dsh.commerce_multi_store_checkouts WHERE id=$1", otherID); err != nil {
			t.Fatalf("remove exclusively test-owned invalid fixture: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("upgrade retained v177 DSH data: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify fully upgraded DSH schema: %v", err)
		}
		retained, err := postgres.ReadMultiStoreCheckoutForClient(ctx, db, parentID, clientID)
		if err != nil || retained.Version != 4 || retained.State != "PROCESSING" ||
			retained.ChildCount != 2 || retained.SuccessfulChildCount != 0 ||
			retained.FailedChildCount != 1 || len(retained.Children) != 2 ||
			retained.Children[0].State != "FAILED" || retained.Children[0].FailureCode != "STALE_QUOTE" ||
			retained.Children[1].State != "PENDING" {
			t.Fatalf("v177 persisted parent/children changed after schema upgrade: %+v err=%v", retained, err)
		}
		var uniqueIndex, redundantIndex bool
		if err := db.QueryRowContext(ctx, `SELECT
			to_regclass('dsh.commerce_multi_store_checkout_children_index_uq') IS NOT NULL,
			to_regclass('dsh.commerce_multi_store_checkout_children_checkout_idx') IS NOT NULL`).Scan(&uniqueIndex, &redundantIndex); err != nil || !uniqueIndex || redundantIndex {
			t.Fatalf("upgraded multi-Store checkout indexes: unique=%t duplicate=%t err=%v", uniqueIndex, redundantIndex, err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("repeat migration must preserve canonical history: %v", err)
		}
	}, 4*time.Minute)
}
