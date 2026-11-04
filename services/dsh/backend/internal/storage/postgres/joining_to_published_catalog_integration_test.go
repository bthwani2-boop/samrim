package postgres_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
	_ "github.com/lib/pq"
)

// publicationQAMedia keeps test-owned image bytes in memory, never in the shared media bucket.
type publicationQAMedia struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (m *publicationQAMedia) EnsureBucket(context.Context) error { return nil }
func (m *publicationQAMedia) Put(_ context.Context, key string, r io.Reader, size int64, _ string) error {
	b, err := io.ReadAll(io.LimitReader(r, size+1))
	if err != nil || int64(len(b)) != size {
		return errors.New("invalid upload length")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[key] = b
	return nil
}
func (m *publicationQAMedia) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.objects, key)
	return nil
}
func (m *publicationQAMedia) Get(_ context.Context, key string) (*media.Object, error) {
	m.mu.Lock()
	b, ok := m.objects[key]
	m.mu.Unlock()
	if !ok {
		return nil, media.ErrObjectNotFound
	}
	return &media.Object{ReadCloser: io.NopCloser(bytes.NewReader(b)), Info: media.ObjectInfo{ContentType: "image/png", Size: int64(len(b))}}, nil
}
func (m *publicationQAMedia) PublicURL(key string) string {
	if media.ValidateObjectKey(key) != nil {
		return ""
	}
	return "https://synthetic-media.invalid/" + key
}

// Validates one approved joining-case identity/Store through the SAME DSH DB,
// real catalog writes and guarded publication to the customer's Store/Offer.
// Identity and WLT are bounded test adapters; this test does NOT prove real
// Identity enrollment, a financial ledger, a mobile checkout, or delivery.
func TestApprovedJoiningToCustomerVisibleCatalog(t *testing.T) {
	rootURL := strings.TrimSpace(os.Getenv("DSH_JOINING_QA_DATABASE_URL"))
	if rootURL == "" {
		t.Skip("dedicated test-owned joining DB unavailable")
	}
	if !joiningQADatabaseIsolated(rootURL, os.Getenv) {
		t.Fatal("refuse non-isolated joining DB")
	}
	root, err := sql.Open("postgres", rootURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, rootURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		keys, err := postgres.NewJoiningCaseEvidenceKeyring("qa-v1", map[string]string{"qa-v1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="})
		if err != nil {
			t.Fatal(err)
		}
		if err = postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err = postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		const city = "qa-journey-city"
		const vertical = "qa-journey-vertical"
		const typeID = "qa-journey-type"
		const owner = "qa-journey-partner"
		const operator = "qa-journey-operator"
		for _, stmt := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('qa-journey-city','مدينة اختبار',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('qa-journey-vertical','متاجر','Stores')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('qa-journey-type','qa-journey-vertical','متجر','Store')",
		} {
			if _, err = db.ExecContext(ctx, stmt); err != nil {
				t.Fatal(err)
			}
		}
		request := postgres.JoiningCaseRequest{
			Phone: "+967700000017", OwnerFullName: "Synthetic Store Owner",
			BusinessName: "Synthetic Store", FirstStoreName: "متجر اختبار المسار",
			FirstStoreAddress:      "صنعاء - مختبر مستقل",
			FirstStoreWorkingHours: json.RawMessage("{\"intervals\":[{\"dayOfWeek\":1,\"opensAt\":\"09:00\",\"closesAt\":\"18:00\"}]}"),
			FirstStoreProofType:    "IDENTITY_DOCUMENT", FirstStoreProofNumber: "TEST-ONLY",
			ServiceCityID: city, VerticalID: vertical, CommercialTypeID: typeID, Latitude: 15.36, Longitude: 44.20,
			FulfillmentModes: []string{"BTHWANI_CAPTAIN"},
		}
		created, err := postgres.CreateJoiningCase(ctx, db, postgres.CreateJoiningCaseInput{
			Request: request, ActingActorID: operator, EvidenceKeyring: keys,
			IdempotencyKey: "qa-journey-create", RequestHash: postgres.HashJoiningCaseRequest(request), CorrelationID: "qa-journey-create-correlation",
		})
		if err != nil || created.Case.State != "draft" {
			t.Fatalf("create joining case: %+v %v", created, err)
		}
		submitted, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, owner, created.Case.Version,
			"qa-journey-submit", postgres.HashJoiningCaseSubmit(created.Case.ID, owner, created.Case.Version), operator, "qa-journey-submit-correlation")
		if err != nil || submitted.Case.State != "submitted" {
			t.Fatalf("submit joining: %+v %v", submitted, err)
		}
		approval := postgres.ReviewJoiningCaseInput{CaseID: created.Case.ID, Decision: "approved", ExpectedVersion: submitted.Case.Version,
			ActingActorID: operator, IdempotencyKey: "qa-journey-approve", CorrelationID: "qa-journey-approve-correlation"}
		approval.RequestHash = postgres.HashJoiningCaseReviewWithFinancialTerms(approval.CaseID, "approved", "", approval.ExpectedVersion, "", "")
		accepted, err := postgres.ReviewJoiningCase(ctx, db, approval)
		if err != nil || accepted.Case.State != "approved" || accepted.Case.StoreID == "" {
			t.Fatalf("approve Store: %+v %v", accepted, err)
		}
		storeID := accepted.Case.StoreID
		productInput := postgres.CatalogProductInput{VerticalID: vertical, Scope: "STORE_SCOPED", StoreID: storeID,
			CanonicalName: "شاحن رحلة اختبار", VariantTitle: "قطعة", MeasurementKind: "DISCRETE", BaseUnit: "COUNT"}
		product, err := postgres.CreateCatalogProduct(ctx, db, productInput, "qa-journey-product",
			postgres.HashCatalogProductCreateRequest(productInput), owner, "qa-journey-product-correlation")
		if err != nil || len(product.Product.Variants) != 1 {
			t.Fatalf("create product: %+v %v", product, err)
		}
		offerInput := postgres.CatalogOfferInput{StoreID: storeID, VariantID: product.Product.Variants[0].ID, PriceMinor: 1450,
			QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1,
			PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY"}
		offer, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "qa-journey-offer",
			postgres.HashCatalogOfferCreateRequest(offerInput), owner, "qa-journey-offer-correlation")
		if err != nil {
			t.Fatal(err)
		}
		update := postgres.CatalogOfferUpdateInput{PriceMinor: 1450, Availability: true, PublicationState: "published",
			QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1,
			PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY"}
		visibleOffer, err := postgres.UpdateCatalogOffer(ctx, db, offer.Offer.ID, update, offer.Offer.Version,
			"qa-journey-publish-offer", postgres.HashCatalogOfferUpdateRequest(offer.Offer.ID, update, offer.Offer.Version),
			owner, "qa-journey-publish-offer-correlation")
		if err != nil || visibleOffer.Offer.PublicationState != "published" {
			t.Fatalf("publish Offer: %+v %v", visibleOffer, err)
		}

		identityHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			switch r.URL.Path {
			case "/internal/actors/" + owner + "/roles/partner":
				_ = json.NewEncoder(w).Encode(map[string]any{"actorId": owner, "role": "partner", "enabled": true, "securityEnabled": true, "activatedAt": "2026-01-01T00:00:00Z"})
			case "/internal/actors/" + operator + "/roles/operator":
				_ = json.NewEncoder(w).Encode(map[string]any{"actorId": operator, "role": "operator", "enabled": true, "securityEnabled": true, "activatedAt": "2026-01-01T00:00:00Z"})
			case "/internal/operators/" + operator + "/permissions/partners":
				_ = json.NewEncoder(w).Encode(map[string]any{"actorId": operator, "permission": "partners", "enabled": true, "version": 1})
			default:
				http.NotFound(w, r)
			}
		}))
		defer identityHTTP.Close()
		agreementActive := false
		wltHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/wlt/v1/store-commercial-agreements" || r.URL.Query().Get("storeId") != storeID {
				http.NotFound(w, r)
				return
			}
			status := "PROPOSED"
			if agreementActive {
				status = "ACTIVE"
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"agreements": []any{map[string]any{
				"agreementId": "qa-agreement", "agreementVersion": 1, "storeId": storeID, "partnerActorId": owner, "status": status,
				"partnerAcceptedByActorId": owner, "partnerAcceptedAt": "2026-01-01T00:00:00Z",
				"financeApprovedByActorId": operator, "financeApprovedAt": "2026-01-01T00:01:00Z",
				"effectiveAt": "2026-01-01T00:01:00Z",
				"rates":       []map[string]any{{"fulfillmentMode": "BTHWANI_CAPTAIN", "commissionRateBps": 1000}},
			}}})
		}))
		defer wltHTTP.Close()
		endpoint, err := identityintegration.ResolveBaseURL(identityHTTP.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		identityClient, err := identityintegration.New(endpoint, strings.Repeat("i", 32))
		if err != nil {
			t.Fatal(err)
		}
		wltClient, err := wltintegration.New(wltHTTP.URL, "test", strings.Repeat("w", 32))
		if err != nil {
			t.Fatal(err)
		}
		publication, err := storepublication.New(identityClient, db, wltClient)
		if err != nil {
			t.Fatal(err)
		}
		store, err := postgres.ReadStore(ctx, db, storeID)
		if err != nil {
			t.Fatal(err)
		}
		_, missing, err := publication.Publish(ctx, storeID, "published", store.Version, "qa-premature-publish", operator, "qa-premature-correlation")
		if !errors.Is(err, storepublication.ErrPublicationReadinessBlocked) || missing.Ready || len(missing.BlockedReasons) < 3 {
			t.Fatalf("missing readiness did not fail closed: %+v %v", missing, err)
		}

		images := &publicationQAMedia{objects: make(map[string][]byte)}
		joining, err := joiningcase.New(identityClient, db, wltClient, images, keys)
		if err != nil {
			t.Fatal(err)
		}
		img := image.NewRGBA(image.Rect(0, 0, 2, 2))
		img.Set(0, 0, color.RGBA{R: 235, G: 111, B: 4, A: 255})
		var imageBytes bytes.Buffer
		if err = png.Encode(&imageBytes, img); err != nil {
			t.Fatal(err)
		}
		provenance := media.Provenance{Creator: "QA creator", SourceDescription: "Test-generated image",
			RightsStatement: "Owned synthetic image, permitted for internal test", RightsAttested: true}
		for _, role := range []string{"primary", "cover"} {
			store, err = postgres.ReadStore(ctx, db, storeID)
			if err != nil {
				t.Fatal(err)
			}
			uploaded, replay, uploadErr := joining.UploadStoreOwnedMedia(ctx, "", operator, storeID, role,
				"qa-image-"+role, "qa-asset-correlation", store.Version, "image/png", imageBytes.Bytes(), provenance)
			if uploadErr != nil || replay || uploaded.Version <= store.Version {
				t.Fatalf("upload %s: %+v replay=%v err=%v", role, uploaded, replay, uploadErr)
			}
		}
		finance := postgres.BindJoiningCaseFinancialTermsInput{CaseID: accepted.Case.ID, SettlementPeriod: "WEEKLY",
			TermsPolicyVersion: "partner-financial-terms:v1", ExpectedVersion: accepted.Case.Version,
			IdempotencyKey: "qa-finance-bind", ActingActorID: operator, CorrelationID: "qa-finance-bind-correlation"}
		finance.RequestHash = postgres.HashJoiningCaseReviewWithFinancialTerms(finance.CaseID, "bind-financial-terms", "", finance.ExpectedVersion,
			finance.SettlementPeriod, finance.TermsPolicyVersion)
		if _, err = postgres.BindApprovedJoiningCaseFinancialTerms(ctx, db, finance); err != nil {
			t.Fatal(err)
		}
		pending, err := postgres.ReadPendingFinancialProfileBinding(ctx, db, accepted.Case.ID)
		if err != nil {
			t.Fatal(err)
		}
		if err = postgres.MarkFinancialProfilePrepared(ctx, db, pending.CaseID, pending.ID, "qa-wlt-profile"); err != nil {
			t.Fatal(err)
		}
		if err = postgres.MarkFinancialProfileActive(ctx, db, pending.CaseID, pending.ID); err != nil {
			t.Fatal(err)
		}
		store, err = postgres.ReadStore(ctx, db, storeID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = postgres.ReadPublishedStore(ctx, db, storeID, city); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("active but unpublished Store leaked: %v", err)
		}
		search, err := postgres.SearchPublicCatalog(ctx, db, city, "", "", "شاحن", 20, "")
		if err != nil || len(search.Offers) != 0 {
			t.Fatalf("active but unpublished Store offer leaked: %+v %v", search, err)
		}
		_, missing, err = publication.Publish(ctx, storeID, "published", store.Version, "qa-agreement-blocked", operator, "qa-blocked-correlation")
		if !errors.Is(err, storepublication.ErrPublicationReadinessBlocked) || missing.Ready {
			t.Fatalf("unapproved agreement allowed: %+v err=%v", missing, err)
		}
		agreementActive = true
		store, err = postgres.ReadStore(ctx, db, storeID)
		if err != nil {
			t.Fatal(err)
		}
		published, ready, err := publication.Publish(ctx, storeID, "published", store.Version, "qa-publish", operator, "qa-publish-correlation")
		if err != nil || !ready.Ready || published.Store.PublicationState != "published" {
			t.Fatalf("publish ready Store: %+v %+v %v", published, ready, err)
		}
		publicStore, err := publication.ReadPublished(ctx, storeID, city)
		if err != nil || publicStore.ID != storeID || publicStore.StoreProfileImage == nil || publicStore.StoreCoverImage == nil {
			t.Fatalf("owner-backed public Store/media unreadable: %+v %v", publicStore, err)
		}
		search, err = publication.SearchPublicCatalog(ctx, city, "", "", "شاحن", 20, "")
		if err != nil || len(search.Offers) != 1 || search.Offers[0].StoreID != storeID || search.Offers[0].Product.ID != product.Product.ID {
			t.Fatalf("published Catalog / Store identity mismatch: %+v %v", search, err)
		}
		verifyPublishedJoiningCheckout(t, ctx, db, storeID, city, owner, visibleOffer.Offer.ID)
		t.Log("Store admission + published Offer + same-Store customer checkout = PASS (isolated DSH; Identity/WLT test adapters)")
	}, 5*time.Minute)
}

// One logical Store must survive joining, publication, customer cart and checkout.
// Payment provisioning is a bounded test adapter here; real WLT ledger effects
// are covered by the separate isolated DSH-to-WLT financial handoff proof.
func verifyPublishedJoiningCheckout(t *testing.T, ctx context.Context, db *sql.DB, storeID, city, partner, offerID string) {
	t.Helper()
	const client = "qa-journey-customer"
	availability, err := postgres.ReadStoreOperationalAvailability(ctx, db, storeID)
	if err != nil {
		t.Fatal(err)
	}
	// Replace the synthetic intake's Monday hours with an owner-approved
	// always-open schedule so the test is independent of the wall-clock day.
	open, replay, err := postgres.UpdateStoreOperationalAvailability(ctx, db, postgres.UpdateStoreOperationalAvailabilityInput{
		StoreID: storeID, ScheduleMode: "ALWAYS_OPEN", ExpectedVersion: availability.Version,
		ActingActorID: partner, AuthoritySource: "STORE_OWNER",
		IdempotencyKey: "qa-journey-open-store", CorrelationID: "qa-journey-open-correlation",
	})
	if err != nil || replay || open.ScheduleMode != "ALWAYS_OPEN" {
		t.Fatalf("owner-approved Store availability: %+v replay=%v err=%v", open, replay, err)
	}

	const addressText = "عنوان تجريبي في صنعاء"
	address, err := postgres.CreateDeliveryAddress(ctx, db, client, addressText, 15.36, 44.20,
		"qa-journey-address", postgres.HashDeliveryAddressCreateRequest(client, addressText, 15.36, 44.20, city),
		"qa-journey-address-correlation", city)
	if err != nil {
		t.Fatal(err)
	}
	cart, replay, err := postgres.UpsertCartLine(ctx, db, client, storeID, offerID, 1, nil, 0,
		"qa-journey-cart", postgres.HashCartLineMutation("line_upsert", storeID, offerID, 1, nil, 0),
		client, "qa-journey-cart-correlation")
	if err != nil || replay || len(cart.Lines) != 1 {
		t.Fatalf("joined Store customer cart: %+v replay=%v err=%v", cart, replay, err)
	}
	store, err := postgres.ReadStore(ctx, db, storeID)
	if err != nil {
		t.Fatal(err)
	}
	var provisioned, cancelled int
	confirmedTotal := int64(2000) // 1,450 StoreOffer + 550 test delivery quote
	input := postgres.CheckoutInput{
		ClientActorID: client, CartID: cart.ID, StoreID: storeID,
		AddressID: address.Address.ID, FulfillmentMode: "BTHWANI_CAPTAIN", PaymentMethod: "CASH_ON_DELIVERY",
		ExpectedTotalAmountMinor: &confirmedTotal, ExpectedCartVersion: cart.Version,
		Evidence: postgres.CheckoutEvidence{
			ServiceCityID: city, StoreVersion: store.Version, AddressVersion: address.Address.Version,
			Status: "SERVICEABLE", PolicyVersion: "qa-journey-city-v1",
			StoreOriginLatitude: 15.36, StoreOriginLongitude: 44.20,
			AddressLatitude: 15.36, AddressLongitude: 44.20,
		},
		IdempotencyKey: "qa-journey-checkout", ActingActorID: client,
		CorrelationID:            "qa-journey-checkout-correlation",
		PaymentExternalReference: "qa-journey-payment-external",
		PaymentIdempotencyKey:    "qa-journey-payment-key", PaymentCancellationKey: "qa-journey-cancel-key",
		Recipient: postgres.DeliveryRecipientInput{Mode: "SELF"}, DeliveryProofKeyring: testDeliveryProofKeyring(t),
		DeliveryFeeResolver: func(_ context.Context, quote postgres.DeliveryFeeQuoteInput) (postgres.DeliveryFeeQuote, error) {
			if quote.StoreID != storeID || quote.FulfillmentMode != "BTHWANI_CAPTAIN" {
				t.Fatal("delivery quote escaped the admitted Store/mode")
			}
			return postgres.DeliveryFeeQuote{FeeMinor: 550, PolicyVersion: "qa-journey-fee-v1"}, nil
		},
		PaymentProvisioner: func(_ context.Context, orderID, _, payer string, _, _, _, _ int64,
			_ string, amount int64, _ postgres.PromotionFunding, _, _ string) (postgres.ProvisionedPayment, error) {
			if orderID == "" || payer != client || amount != confirmedTotal {
				t.Fatalf("wrong customer payment facts: order=%s payer=%s amount=%d", orderID, payer, amount)
			}
			provisioned++
			return postgres.ProvisionedPayment{IntentID: "qa-journey-payment", State: "REQUIRES_COLLECTION", CashAmountMinor: amount}, nil
		},
		PaymentIntentRecoveryReader: func(context.Context, string) (postgres.PaymentIntentRecoveryRecord, bool, error) {
			return postgres.PaymentIntentRecoveryRecord{}, false, nil
		},
		PaymentCanceller: func(context.Context, string, string, string, string) error {
			cancelled++
			return nil
		},
	}
	input.RequestHash = postgres.HashCheckoutRequest(input)
	bad := input
	badTotal := confirmedTotal + 1
	bad.ExpectedTotalAmountMinor = &badTotal
	bad.IdempotencyKey = "qa-journey-bad-quote"
	bad.RequestHash = postgres.HashCheckoutRequest(bad)
	if _, _, err = postgres.CreateOrderFromCart(ctx, db, bad); !errors.Is(err, postgres.ErrCheckoutEvidenceStale) || provisioned != 0 {
		t.Fatalf("unconfirmed price must fail before payment: %v provisioned=%d", err, provisioned)
	}
	order, replay, err := postgres.CreateOrderFromCart(ctx, db, input)
	if err != nil || replay || order.State != "CREATED" || order.StoreID != storeID ||
		order.ClientActorID != client || order.TotalAmountMinor != confirmedTotal ||
		order.PaymentIntentID == nil || *order.PaymentIntentID != "qa-journey-payment" ||
		len(order.Lines) != 1 || order.Lines[0].StoreOfferID != offerID {
		t.Fatalf("joined Store did not reach one customer Order: %+v replay=%v err=%v", order, replay, err)
	}
	again, replay, err := postgres.CreateOrderFromCart(ctx, db, input)
	if err != nil || !replay || again.ID != order.ID || provisioned != 1 || cancelled != 0 {
		t.Fatalf("joined Store checkout replay duplicated payment: %+v replay=%v provisions=%d cancels=%d err=%v",
			again, replay, provisioned, cancelled, err)
	}
	own, err := postgres.ReadOrderForClient(ctx, db, order.ID, client)
	if err != nil || own.StoreID != storeID {
		t.Fatalf("canonical customer order readback: %+v err=%v", own, err)
	}
	if _, err := postgres.ReadOrderForClient(ctx, db, order.ID, "qa-foreign-client"); !errors.Is(err, postgres.ErrOrderNotFound) {
		t.Fatalf("foreign customer accessed the order: %v", err)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_orders WHERE store_id=$1 AND client_actor_id=$2", storeID, client).Scan(&count); err != nil || count != 1 {
		t.Fatalf("joining-derived Store produced %d orders, err=%v", count, err)
	}
}
