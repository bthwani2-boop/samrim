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
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id,partner_actor_id,name) VALUES($1,$2,$3)", store.id, store.partner, store.name); err != nil {
				t.Fatalf("insert store %s: %v", store.id, err)
			}
		}
		for _, cart := range []struct{ id, storeID string }{{firstCartID, firstStoreID}, {secondCartID, secondStoreID}} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cart.id, clientID, cart.storeID); err != nil {
				t.Fatalf("insert cart %s: %v", cart.id, err)
			}
		}

		input := postgres.MultiStoreCheckoutInput{ID: checkoutID, ClientActorID: clientID, Children: []postgres.MultiStoreCheckoutChildInput{
			{CartID: firstCartID, StoreID: firstStoreID, AddressID: "address-one", CartVersion: 1, FulfillmentMode: "BTHWANI_CAPTAIN"},
			{CartID: secondCartID, StoreID: secondStoreID, AddressID: "address-two", CartVersion: 1, FulfillmentMode: "BTHWANI_CAPTAIN"},
		}}
		requestHash := postgres.HashMultiStoreCheckoutRequest(input)
		checkout, replayed, err := postgres.CreateMultiStoreCheckout(ctx, db, input, createKey, requestHash)
		if err != nil || replayed || checkout.State != "PROCESSING" || len(checkout.Children) != 2 {
			t.Fatalf("create parent/children = %+v replayed=%t err=%v", checkout, replayed, err)
		}
		replay, replayed, err := postgres.CreateMultiStoreCheckout(ctx, db, input, createKey, requestHash)
		if err != nil || !replayed || replay.ID != checkoutID || len(replay.Children) != 2 {
			t.Fatalf("same-key create replay = %+v replayed=%t err=%v", replay, replayed, err)
		}
		changed := input
		changed.Children = append([]postgres.MultiStoreCheckoutChildInput(nil), input.Children...)
		changed.Children[1].CartVersion++
		if _, _, err := postgres.CreateMultiStoreCheckout(ctx, db, changed, createKey, postgres.HashMultiStoreCheckoutRequest(changed)); !errors.Is(err, postgres.ErrMultiStoreCheckoutIdempotencyConflict) {
			t.Fatalf("changed same-key create = %v; want idempotency conflict", err)
		}
		if _, err := postgres.ReadMultiStoreCheckoutForClient(ctx, db, checkoutID, "another-client"); !errors.Is(err, postgres.ErrMultiStoreCheckoutNotFound) {
			t.Fatalf("cross-client parent read = %v; want not found", err)
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
