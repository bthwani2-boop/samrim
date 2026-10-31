package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// The test requires a disposable PostgreSQL root DSN. withFreshDatabase
// creates and drops a fresh database without touching the running DSH data.
func TestStoreOrderRatingsPageIsScopedAndExcludesCustomerIdentity(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, uri, func(ctx context.Context, db *sql.DB, migrations []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, migrations, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		for _, stmt := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('review-city','Test City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('review-vertical','Test Vertical','Test Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('review-type','review-vertical','Test Type','Test Type')",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('review-store-a','review-partner-a','Store A','review-city','review-vertical','review-type','unpublished',ARRAY['CUSTOMER_PICKUP'])",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('review-store-b','review-partner-b','Store B','review-city','review-vertical','review-type','unpublished',ARRAY['CUSTOMER_PICKUP'])",
		} {
			if _, err := db.ExecContext(ctx, stmt); err != nil {
				t.Fatal(err)
			}
		}
		for i, row := range []struct{ id, store, client, created string }{
			{"review-a1", "review-store-a", "review-client-1", "2026-10-29T12:00:00Z"},
			{"review-a2", "review-store-a", "review-client-2", "2026-10-31T12:00:00Z"},
			{"review-a3", "review-store-a", "review-client-3", "2026-10-31T12:00:00Z"},
			{"review-b1", "review-store-b", "review-client-4", "2026-10-31T12:00:00Z"},
		} {
			cart := "review-cart-" + row.id
			if _, err := db.ExecContext(ctx,
				"INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)",
				cart, row.client, row.store); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
				id,client_actor_id,store_id,cart_id,service_city_id,serviceability_store_version,
				state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,
				fulfillment_mode,payment_cash_amount_minor,cancellation_mode,cancellation_policy_version)
				VALUES($1,$2,$3,$4,'review-city',1,'DELIVERED',200,'YER',1,$5,'CASH_AT_STORE',
				'REQUIRES_COLLECTION','CUSTOMER_PICKUP',200,'OPERATIONS_ONLY',1)`,
				row.id, row.client, row.store, cart, "review-payment-"+row.id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_order_ratings(
				order_id,client_actor_id,store_id,rating,review,idempotency_key,request_hash,created_at)
				VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
				row.id, row.client, row.store, i%5+1, "review "+row.id,
				"rating-key-"+row.id, strings.Repeat("a", 64), row.created); err != nil {
				t.Fatal(err)
			}
		}
		first, err := postgres.ListStoreOrderRatings(ctx, db, "review-store-a", 2, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(first.Ratings) != 2 || first.NextCursor == "" ||
			first.Ratings[0].OrderID != "review-a3" || first.Ratings[1].OrderID != "review-a2" {
			t.Fatalf("incorrect first page or tied-timestamp ordering: %+v", first)
		}
		if first.Summary.TotalRatings != 3 || first.Summary.AverageRating != 2 ||
			first.Summary.OneStar != 1 || first.Summary.TwoStars != 1 || first.Summary.ThreeStars != 1 ||
			first.Summary.FourStars != 0 || first.Summary.FiveStars != 0 {
			t.Fatalf("incorrect Store A summary independent of cursor: %+v", first.Summary)
		}
		for _, rating := range first.Ratings {
			if rating.StoreID != "review-store-a" || rating.ClientActorID != "" {
				t.Fatalf("Store scope or customer identity leaked: %+v", rating)
			}
		}
		second, err := postgres.ListStoreOrderRatings(ctx, db, "review-store-a", 2, first.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
		if second.Summary != first.Summary {
			t.Fatalf("Store summary changed when paging: %+v, %+v", first.Summary, second.Summary)
		}
		if len(second.Ratings) != 1 || second.Ratings[0].OrderID != "review-a1" || second.NextCursor != "" {
			t.Fatalf("incorrect second page: %+v", second)
		}
		foreign, err := postgres.ListStoreOrderRatings(ctx, db, "review-store-b", 20, "")
		if err != nil || len(foreign.Ratings) != 1 || foreign.Ratings[0].OrderID != "review-b1" ||
			foreign.Summary.TotalRatings != 1 || foreign.Summary.AverageRating != 4 || foreign.Summary.FourStars != 1 {
			t.Fatalf("Store B improperly includes another Store's data: %+v %v", foreign, err)
		}
		for _, cursor := range []string{"not-a-cursor", strings.Repeat("x", 1025)} {
			if _, err := postgres.ListStoreOrderRatings(ctx, db, "review-store-a", 20, cursor); !errors.Is(err, postgres.ErrOrderRatingInvalid) {
				t.Fatalf("invalid Store rating cursor accepted: %v", err)
			}
		}
	})
}
