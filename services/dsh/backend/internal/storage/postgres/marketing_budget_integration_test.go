package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestPromotionDiscountBudgetConcurrentRedemptionAndCancellation(t *testing.T) {
	rootURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if rootURL == "" {
		t.Skip("DSH_DATABASE_URL must point to an isolated test PostgreSQL instance")
	}
	root, err := sql.Open("postgres", rootURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, rootURL, func(ctx context.Context, db *sql.DB, migrations []postgres.MigrationRecord, source []string) {
		if err := postgres.Migrate(ctx, db, migrations, source, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const city, store, promo = "budget-city", "budget-store", "budget-promotion"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Budget Test City',true)", city); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: "budget-partner", Name: "Budget Test Store", ServiceCityID: city})
		limit := int64(300)
		record, replayed, err := postgres.CreatePromotion(ctx, db, postgres.PromotionInput{
			ID: promo, Code: "BUDGET100", NameAr: "عرض بميزانية",
			Kind: "FIXED", ValueMinor: 100, FundingSource: "BTHWANI",
			DiscountBudgetLimitMinor: &limit,
			StartsAt:                 time.Now().UTC().Add(-time.Hour), CreatedByActorID: "budget-operator",
		}, "budget-create", postgres.HashMarketingFacts("budget-create"))
		if err != nil || replayed || record.DiscountBudgetLimitMinor == nil || *record.DiscountBudgetLimitMinor != limit {
			t.Fatalf("create capped promotion: %+v replay=%t err=%v", record, replayed, err)
		}
		if _, _, err := postgres.SetPromotionState(ctx, db, promo, "PUBLISHED", "budget-publish", postgres.HashMarketingFacts("budget-publish"), record.Version); err != nil {
			t.Fatal(err)
		}
		insertOrder := func(i int) (string, string) {
			t.Helper()
			actor, cart, order := fmt.Sprintf("budget-client-%d", i), fmt.Sprintf("budget-cart-%d", i), fmt.Sprintf("budget-order-%d", i)
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cart, actor, store); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
				id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
				service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,
				state,total_amount_minor,subtotal_amount_minor,discount_minor,promotion_id,promotion_code,promotion_version,promotion_funding_source,currency,version,
				payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor)
				VALUES($1,$2,$3,$4,$5,1,'Test address',15.36,44.19,$6,'CITY_SCOPE_V1','SERVICEABLE',1,1,
				'CREATED',900,1000,100,$7,'BUDGET100',2,'BTHWANI','YER',1,$8,'CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',900)`,
				order, actor, store, cart, "budget-address-"+order, city, promo, "budget-payment-"+order); err != nil {
				t.Fatal(err)
			}
			return actor, order
		}
		const attempts = 8
		for i := 0; i < attempts; i++ {
			insertOrder(i)
		}
		var wg sync.WaitGroup
		var mu sync.Mutex
		success, budgetDenied := 0, 0
		problems := make([]error, 0)
		for i := 0; i < attempts; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				actor, order := fmt.Sprintf("budget-client-%d", i), fmt.Sprintf("budget-order-%d", i)
				tx, err := db.BeginTx(ctx, nil)
				if err != nil {
					mu.Lock()
					problems = append(problems, err)
					mu.Unlock()
					return
				}
				defer tx.Rollback()
				err = postgres.RedeemPromotion(ctx, tx, postgres.PromotionRecord{ID: promo, Code: "BUDGET100"}, actor, order, 100)
				if err == nil {
					err = tx.Commit()
				}
				mu.Lock()
				defer mu.Unlock()
				switch {
				case err == nil:
					success++
				case errors.Is(err, postgres.ErrPromotionLimitReached):
					budgetDenied++
				default:
					problems = append(problems, err)
				}
			}(i)
		}
		wg.Wait()
		if len(problems) > 0 || success != 3 || budgetDenied != attempts-3 {
			t.Fatalf("concurrent budget: success=%d denied=%d errors=%v", success, budgetDenied, problems)
		}
		assertBudget := func(count, spent int64) {
			t.Helper()
			latest, err := postgres.ReadPromotion(ctx, db, promo)
			if err != nil || latest.RedeemedCount != count || latest.DiscountSpentMinor != spent {
				t.Fatalf("budget owner state: %+v err=%v want count=%d spent=%d", latest, err, count, spent)
			}
		}
		assertBudget(3, 300)
		// Cancellation of one accepted, uncollected order releases exactly 100.
		var cancelOrder string
		if err := db.QueryRowContext(ctx, "SELECT order_id FROM dsh.commerce_promotion_redemptions WHERE promotion_id=$1 ORDER BY order_id LIMIT 1", promo).Scan(&cancelOrder); err != nil {
			t.Fatal(err)
		}
		cancelled, wasReplay, err := postgres.TransitionOrder(ctx, db, cancelOrder, "CANCELLED", "", 1, "budget-cancel", postgres.HashMarketingFacts("budget-cancel"), "budget-operator", "budget-correlation")
		if err != nil || wasReplay || cancelled.State != "CANCELLED" {
			t.Fatalf("cancel order: %+v replay=%t err=%v", cancelled, wasReplay, err)
		}
		assertBudget(2, 200)
		_, wasReplay, err = postgres.TransitionOrder(ctx, db, cancelOrder, "CANCELLED", "", 1, "budget-cancel", postgres.HashMarketingFacts("budget-cancel"), "budget-operator", "budget-correlation")
		if err != nil || !wasReplay {
			t.Fatalf("repeat cancellation: replay=%t err=%v", wasReplay, err)
		}
		assertBudget(2, 200)
		var rejectedOrder string
		for i := 0; i < attempts; i++ {
			candidate := fmt.Sprintf("budget-order-%d", i)
			var exists bool
			if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.commerce_promotion_redemptions WHERE order_id=$1)", candidate).Scan(&exists); err != nil {
				t.Fatal(err)
			}
			if !exists && candidate != cancelOrder {
				rejectedOrder = candidate
				break
			}
		}
		if rejectedOrder == "" {
			t.Fatal("expected one initially rejected order")
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := postgres.RedeemPromotion(ctx, tx, postgres.PromotionRecord{ID: promo, Code: "BUDGET100"}, "budget-client-"+strings.TrimPrefix(rejectedOrder, "budget-order-"), rejectedOrder, 100); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		assertBudget(3, 300)
	})
}
