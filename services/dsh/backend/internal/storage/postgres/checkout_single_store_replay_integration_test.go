package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// This proof owns only a disposable DSH database. Real WLT financial effects
// are checked separately by the isolated WLT ledger/retry suite.
func TestConcurrentSingleStoreCheckoutPersistsExactlyOneOrder(t *testing.T) {
	raw := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if raw == "" {
		t.Skip("dedicated isolated DSH_DATABASE_URL required")
	}
	target, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	name := strings.TrimPrefix(target.Path, "/")
	isCI := target.Port() == "19432" && name == "dsh_proof" && target.User != nil && target.User.Username() == "postgres"
	isLocal := target.Port() == "15439" && name == "bthwani_wlt_finance_proof" && target.User != nil && target.User.Username() == "finance_proof"
	if os.Getenv("BTHWANI_FINANCIAL_PROOF_ISOLATED") != "1" || target.Scheme != "postgres" ||
		target.Hostname() != "127.0.0.1" || (!isCI && !isLocal) ||
		name != os.Getenv("BTHWANI_EXPECTED_DATABASE_NAME") || target.Fragment != "" {
		t.Fatal("refuse checkout proof against a non-isolated PostgreSQL target")
	}
	for key := range target.Query() {
		if key != "sslmode" && key != "connect_timeout" {
			t.Fatal("connection-routing override is forbidden")
		}
	}
	root, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, raw, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, statements []string) {
		if err := postgres.Migrate(ctx, db, records, statements, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		const city, store, owner, client = "replay-city", "replay-store", "replay-owner", "replay-customer"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'مدينة اختبار',true)", city); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: store, PartnerActorID: owner, Name: "متجر اختبار التكرار", ServiceCityID: city, PublicationState: "published",
		})
		// Fixture only establishes a test-owned admitted Store; the Order itself is
		// created exclusively by the canonical DSH checkout owner.
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.joining_cases(id,contact_phone_e164,business_name,first_store_name,partner_actor_id,first_store_vertical_id,first_store_commercial_type_id,state,store_id,origin,financial_profile_state) VALUES('replay-joining','+967700000912','Replay Store','Replay Store',$1,$2,$3,'approved',$4,'control_panel','ACTIVE')",
			owner, store+"-vertical", store+"-type", store); err != nil {
			t.Fatal(err)
		}
		productInput := postgres.CatalogProductInput{VerticalID: store + "-vertical", Scope: "STORE_SCOPED", StoreID: store,
			CanonicalName: "منتج تكرار طلب", VariantTitle: "قطعة", MeasurementKind: "DISCRETE", BaseUnit: "COUNT"}
		product, err := postgres.CreateCatalogProduct(ctx, db, productInput, "replay-product",
			postgres.HashCatalogProductCreateRequest(productInput), owner, "replay-product-correlation")
		if err != nil || len(product.Product.Variants) != 1 {
			t.Fatalf("product %+v err=%v", product, err)
		}
		offerInput := postgres.CatalogOfferInput{StoreID: store, VariantID: product.Product.Variants[0].ID,
			PriceMinor: 1450, QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5,
			QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY"}
		offer, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "replay-offer",
			postgres.HashCatalogOfferCreateRequest(offerInput), owner, "replay-offer-correlation")
		if err != nil {
			t.Fatal(err)
		}
		update := postgres.CatalogOfferUpdateInput{PriceMinor: 1450, Availability: true, PublicationState: "published",
			QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5,
			QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY"}
		if _, err := postgres.UpdateCatalogOffer(ctx, db, offer.Offer.ID, update, offer.Offer.Version,
			"replay-offer-publish", postgres.HashCatalogOfferUpdateRequest(offer.Offer.ID, update, offer.Offer.Version),
			owner, "replay-offer-publish-correlation"); err != nil {
			t.Fatal(err)
		}
		catalog, err := postgres.ReadPublicCatalog(ctx, db, store, city, "", "", "", 10, "")
		if err != nil || len(catalog.Offers) != 1 {
			t.Fatalf("visible catalog %+v err=%v", catalog, err)
		}
		addressText := "عنوان اختبار توصيل في صنعاء"
		address, err := postgres.CreateDeliveryAddress(ctx, db, client, addressText, 15.36, 44.20,
			"replay-address", postgres.HashDeliveryAddressCreateRequest(client, addressText, 15.36, 44.20, city),
			"replay-address-correlation", city)
		if err != nil {
			t.Fatal(err)
		}
		cart, cartReplay, err := postgres.UpsertCartLine(ctx, db, client, store, offer.Offer.ID, 1,
			nil, 0, "replay-cart-line", postgres.HashCartLineMutation("line_upsert", store, offer.Offer.ID, 1, nil, 0),
			client, "replay-cart-correlation")
		if err != nil || cartReplay || len(cart.Lines) != 1 || cart.Version != 1 {
			t.Fatalf("cart %+v replay=%t err=%v", cart, cartReplay, err)
		}
		// Omitted optional modifiers must also remain an empty array on updates.
		cart, cartReplay, err = postgres.UpdateCartLine(ctx, db, client, cart.Lines[0].ID, 1, nil,
			cart.Version, "replay-cart-update",
			postgres.HashCartLineMutation("line_upsert", store, cart.Lines[0].ID, 1, nil, cart.Version),
			client, "replay-cart-update-correlation")
		if err != nil || cartReplay || len(cart.Lines) != 1 || cart.Version != 2 {
			t.Fatalf("update cart without modifiers: %+v replay=%t err=%v", cart, cartReplay, err)
		}
		stored, err := postgres.ReadStore(ctx, db, store)
		if err != nil {
			t.Fatal(err)
		}
		total := int64(2000)
		var provisions, compensations atomic.Int32
		input := postgres.CheckoutInput{
			ClientActorID: client, CartID: cart.ID, StoreID: store, AddressID: address.Address.ID,
			FulfillmentMode: "BTHWANI_CAPTAIN", PaymentMethod: "CASH_ON_DELIVERY",
			ExpectedTotalAmountMinor: &total, ExpectedCartVersion: cart.Version,
			Evidence: postgres.CheckoutEvidence{ServiceCityID: city, StoreVersion: stored.Version,
				AddressVersion: address.Address.Version, Status: "SERVICEABLE", PolicyVersion: "replay-city-v1",
				StoreOriginLatitude: 15.36, StoreOriginLongitude: 44.20, AddressLatitude: 15.36, AddressLongitude: 44.20},
			IdempotencyKey: "replay-checkout-key", ActingActorID: client, CorrelationID: "replay-checkout-correlation",
			PaymentExternalReference: "replay-payment-ref", PaymentIdempotencyKey: "replay-payment-key",
			PaymentCancellationKey: "replay-payment-cancel", Recipient: postgres.DeliveryRecipientInput{Mode: "SELF"},
			DeliveryProofKeyring: testDeliveryProofKeyring(t),
			DeliveryFeeResolver: func(context.Context, postgres.DeliveryFeeQuoteInput) (postgres.DeliveryFeeQuote, error) {
				return postgres.DeliveryFeeQuote{FeeMinor: 550, PolicyVersion: "replay-fee-v1"}, nil
			},
			PaymentProvisioner: func(_ context.Context, _, _, _ string, _, _, _, _ int64,
				_ string, amount int64, _ postgres.PromotionFunding, _, _ string) (postgres.ProvisionedPayment, error) {
				provisions.Add(1)
				return postgres.ProvisionedPayment{IntentID: "replay-test-intent", State: "REQUIRES_COLLECTION", CashAmountMinor: amount}, nil
			},
			PaymentIntentRecoveryReader: func(context.Context, string) (postgres.PaymentIntentRecoveryRecord, bool, error) {
				return postgres.PaymentIntentRecoveryRecord{}, false, nil
			},
			PaymentCanceller: func(context.Context, string, string, string, string) error {
				compensations.Add(1)
				return nil
			},
		}
		input.RequestHash = postgres.HashCheckoutRequest(input)
		const workers = 8
		type outcome struct {
			order    postgres.OrderRecord
			replayed bool
			err      error
		}
		results := make(chan outcome, workers)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for i := 0; i < workers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				o, r, e := postgres.CreateOrderFromCart(ctx, db, input)
				results <- outcome{o, r, e}
			}()
		}
		close(start)
		wg.Wait()
		close(results)
		id := ""
		fresh, replays := 0, 0
		for r := range results {
			if r.err != nil || r.order.State != "CREATED" || r.order.TotalAmountMinor != total {
				t.Fatalf("parallel checkout result=%+v replay=%t err=%v", r.order, r.replayed, r.err)
			}
			if id != "" && r.order.ID != id {
				t.Fatalf("duplicate order IDs %s and %s", id, r.order.ID)
			}
			id = r.order.ID
			if r.replayed {
				replays++
			} else {
				fresh++
			}
		}
		if fresh != 1 || replays != workers-1 || provisions.Load() != 1 || compensations.Load() != 0 {
			t.Fatalf("fresh=%d replays=%d payment provisions=%d compensations=%d",
				fresh, replays, provisions.Load(), compensations.Load())
		}
		count := func(query string, want int, args ...any) {
			t.Helper()
			var actual int
			if e := db.QueryRowContext(ctx, query, args...).Scan(&actual); e != nil || actual != want {
				t.Fatalf("count=%d want=%d err=%v query=%s", actual, want, e, query)
			}
		}
		count("SELECT count(*) FROM dsh.commerce_orders WHERE cart_id=$1 AND client_actor_id=$2", 1, cart.ID, client)
		count("SELECT count(*) FROM dsh.commerce_order_lines WHERE order_id=$1", 1, id)
		count("SELECT count(*) FROM dsh.commerce_order_checkout_idempotency WHERE cart_id=$1", 1, cart.ID)
		count("SELECT count(*) FROM dsh.commerce_order_audit WHERE order_id=$1 AND event_type='order_created'", 1, id)
		count("SELECT count(*) FROM dsh.commerce_order_payment_audit WHERE order_id=$1 AND event_type='payment_intent_linked'", 1, id)
		// Simulate losing the success response after the commit, then recover from
		// the persisted owner record without issuing another payment provision.
		recovered, wasReplay, err := postgres.ResolveCheckoutAttempt(ctx, db, input)
		if err != nil || !wasReplay || recovered.ID != id {
			t.Fatalf("post-commit recovery=%+v replay=%t err=%v", recovered, wasReplay, err)
		}
		repeated, wasReplay, err := postgres.CreateOrderFromCart(ctx, db, input)
		if err != nil || !wasReplay || repeated.ID != id {
			t.Fatalf("same-key retry=%+v replay=%t err=%v", repeated, wasReplay, err)
		}
		changed := input
		modified := total + 1
		changed.ExpectedTotalAmountMinor = &modified
		changed.RequestHash = postgres.HashCheckoutRequest(changed)
		if _, _, err := postgres.CreateOrderFromCart(ctx, db, changed); !errors.Is(err, postgres.ErrCheckoutIdempotencyConflict) {
			t.Fatalf("same-key changed total was not rejected: %v", err)
		}
		different := input
		different.IdempotencyKey = "replay-other-checkout-key"
		different.RequestHash = postgres.HashCheckoutRequest(different)
		if _, _, err := postgres.CreateOrderFromCart(ctx, db, different); !errors.Is(err, postgres.ErrCheckoutEvidenceStale) {
			t.Fatalf("second key cannot reuse consumed cart: %v", err)
		}
		current, err := postgres.ReadOrderForClient(ctx, db, id, client)
		if err != nil || current.ID != id || current.PaymentState != "REQUIRES_COLLECTION" || len(current.Lines) != 1 {
			t.Fatalf("canonical DSH order readback=%+v err=%v", current, err)
		}
		count("SELECT count(*) FROM dsh.commerce_orders WHERE cart_id=$1", 1, cart.ID)
		if provisions.Load() != 1 || compensations.Load() != 0 {
			t.Fatal("retry repeated payment provisioning or cancellation")
		}
		t.Logf("concurrent 8 workers: one Order %s, one payment provisioning, 7 replays, durable retry recovery", id)
	}, 6*time.Minute)
}
