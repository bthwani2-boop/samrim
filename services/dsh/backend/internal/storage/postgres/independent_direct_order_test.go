package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"
)

func validDirectPickup() IndependentDirectOrderRequest {
	return IndependentDirectOrderRequest{
		StoreID: "store-a", IdempotencyKey: base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("Z", 32))),
		GuestName: "Guest Buyer", GuestPhoneE164: "+967700001122",
		ExpectedMerchantPolicyVersion: "v1", ExpectedSubtotalMinor: 1200,
		FulfillmentMode: "CUSTOMER_PICKUP",
		Lines:           []IndependentDirectOrderLineRequest{{OfferID: "a", QuantityBaseUnits: 1}, {OfferID: "b", QuantityBaseUnits: 2}},
	}
}

func TestIndependentOrderRejectsUntrustedOrAmbiguousFacts(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*IndependentDirectOrderRequest)
	}{
		{"missing store", func(r *IndependentDirectOrderRequest) { r.StoreID = "" }},
		{"NUL in Store", func(r *IndependentDirectOrderRequest) { r.StoreID = "store\x00a" }},
		{"invalid UTF8 Store", func(r *IndependentDirectOrderRequest) { r.StoreID = string([]byte{0xff}) }},
		{"embedded newline in Store", func(r *IndependentDirectOrderRequest) { r.StoreID = "store\na" }},
		{"weak attempt key", func(r *IndependentDirectOrderRequest) { r.IdempotencyKey = "x" }},
		{"non canonical attempt", func(r *IndependentDirectOrderRequest) { r.IdempotencyKey = strings.Repeat("!", 43) }},
		{"invalid phone", func(r *IndependentDirectOrderRequest) { r.GuestPhoneE164 = "077000" }},
		{"no reviewed merchant policy acknowledgement", func(r *IndependentDirectOrderRequest) { r.ExpectedMerchantPolicyVersion = "" }},
		{"invalid merchant policy identifier", func(r *IndependentDirectOrderRequest) { r.ExpectedMerchantPolicyVersion = "v1\nforged" }},
		{"overlong merchant policy identifier", func(r *IndependentDirectOrderRequest) { r.ExpectedMerchantPolicyVersion = strings.Repeat("v", 129) }},
		{"missing displayed subtotal", func(r *IndependentDirectOrderRequest) { r.ExpectedSubtotalMinor = 0 }},
		{"negative displayed subtotal", func(r *IndependentDirectOrderRequest) { r.ExpectedSubtotalMinor = -1 }},
		{"empty buyer", func(r *IndependentDirectOrderRequest) { r.GuestName = "" }},
		{"guest name contains NUL", func(r *IndependentDirectOrderRequest) { r.GuestName = "Gue\x00st" }},
		{"guest name contains newline", func(r *IndependentDirectOrderRequest) { r.GuestName = "Guest\nBuyer" }},
		{"guest name invalid UTF8", func(r *IndependentDirectOrderRequest) { r.GuestName = string([]byte{0xff, 0xfe}) }},
		{"platform captain", func(r *IndependentDirectOrderRequest) { r.FulfillmentMode = "BTHWANI_CAPTAIN" }},
		{"wallet pay injection", func(r *IndependentDirectOrderRequest) { r.FulfillmentMode = "WALLET" }},
		{"missing lines", func(r *IndependentDirectOrderRequest) { r.Lines = nil }},
		{"duplicate offer", func(r *IndependentDirectOrderRequest) { r.Lines[1].OfferID = "a" }},
		{"offer with NUL", func(r *IndependentDirectOrderRequest) { r.Lines[0].OfferID = "offer\x00a" }},
		{"offer with newline", func(r *IndependentDirectOrderRequest) { r.Lines[0].OfferID = "offer\na" }},
		{"offer with invalid UTF8", func(r *IndependentDirectOrderRequest) { r.Lines[0].OfferID = string([]byte{0xff}) }},
		{"negative quantity", func(r *IndependentDirectOrderRequest) { r.Lines[0].QuantityBaseUnits = -1 }},
		{"too many lines", func(r *IndependentDirectOrderRequest) {
			r.Lines = make([]IndependentDirectOrderLineRequest, 21)
			for i := range r.Lines {
				r.Lines[i] = IndependentDirectOrderLineRequest{OfferID: strings.Repeat("x", i+1), QuantityBaseUnits: 1}
			}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := validDirectPickup()
			tt.mutate(&input)
			if _, _, _, err := normalizedIndependentOrder(input); !errors.Is(err, ErrIndependentOrderInvalid) {
				t.Fatalf("expected fail closed: %v", err)
			}
		})
	}
}

func TestIndependentOrderNormalizationDoesNotMutateCallerCart(t *testing.T) {
	input := validDirectPickup()
	input.Lines[0], input.Lines[1] = input.Lines[1], input.Lines[0]
	normalized, _, _, err := normalizedIndependentOrder(input)
	if err != nil {
		t.Fatal(err)
	}
	if input.Lines[0].OfferID != "b" || input.Lines[1].OfferID != "a" {
		t.Fatal("normalization must never reorder a caller-owned cart slice")
	}
	if normalized.Lines[0].OfferID != "a" || normalized.Lines[1].OfferID != "b" {
		t.Fatal("idempotency normalization must be canonical without side effects")
	}
	normalized.Lines[0].QuantityBaseUnits = 999
	if input.Lines[1].QuantityBaseUnits == 999 {
		t.Fatal("normalized Lines must own their own backing slice")
	}
}

func TestIndependentPublicCatalogOnlyListsSupportedDirectOffers(t *testing.T) {
	for _, gate := range []string{
		"o.pricing_basis='PER_UNIT'",
		"o.inventory_policy='AVAILABILITY_ONLY'",
		"o.quantity_min_base_units > 0",
		"o.quantity_max_base_units >= o.quantity_min_base_units",
		"o.quantity_step_base_units > 0",
		"MOD(o.quantity_min_base_units,o.pricing_unit_base_units)=0",
		"catalog_store_offer_modifier_groups",
		"catalog_publishable_offers",
		"o.pricing_unit_base_units=1",
		"p.store_id=s.id",
	} {
		if !strings.Contains(independentDirectBuyableOfferSQL, gate) {
			t.Errorf("public catalog can advertise unpriceable independent Offer: missing %q", gate)
		}
	}
}

func TestIndependentOrderIdempotencyBindsStoreAndCanonicalRequest(t *testing.T) {
	first := validDirectPickup()
	_, key1, hash1, err := normalizedIndependentOrder(first)
	if err != nil {
		t.Fatal(err)
	}
	first.Lines[0], first.Lines[1] = first.Lines[1], first.Lines[0]
	_, key2, hash2, err := normalizedIndependentOrder(first)
	if err != nil {
		t.Fatal(err)
	}
	if key1 != key2 || hash1 != hash2 {
		t.Fatal("exact reordered attempt must retain same key and request hash")
	}
	first.StoreID = "store-b"
	_, key3, hash3, err := normalizedIndependentOrder(first)
	if err != nil {
		t.Fatal(err)
	}
	if key1 != key3 || hash1 == hash3 {
		t.Fatal("cross-Store reuse must be distinguishable from exact replay")
	}
	first.StoreID = "store-a"
	first.Lines[0].QuantityBaseUnits++
	_, key4, hash4, err := normalizedIndependentOrder(first)
	if err != nil {
		t.Fatal(err)
	}
	if key4 != key1 || hash4 == hash1 {
		t.Fatal("changed quantity with same idempotency key must conflict")
	}
}

func TestIndependentGuestCapabilityNotRecoverableWithoutServerSecret(t *testing.T) {
	secretA := []byte(strings.Repeat("a", 32))
	secretB := []byte(strings.Repeat("b", 32))
	token, digest, err := independentGuestCapability(secretA, "key-hash")
	if err != nil {
		t.Fatal(err)
	}
	again, sameDigest, err := independentGuestCapability(secretA, "key-hash")
	if err != nil || again != token || sameDigest != digest {
		t.Fatal("exact replay must retain purpose-limited capability")
	}
	otherToken, otherDigest, err := independentGuestCapability(secretB, "key-hash")
	if err != nil || otherToken == token || otherDigest == digest {
		t.Fatal("capability must depend on high entropy server secret")
	}
	if _, _, err := independentGuestCapability([]byte("short"), "key-hash"); !errors.Is(err, ErrIndependentOrderInvalid) {
		t.Fatal("weak capability secret must fail")
	}
	wantHash := sha256.Sum256([]byte(token))
	if digest != hex.EncodeToString(wantHash[:]) || strings.Contains(digest, token) {
		t.Fatal("only token hash, not plaintext, is persisted")
	}
}

func TestIndependentDirectQuoteUsesExactCheckedIntegerMath(t *testing.T) {
	for _, test := range []struct {
		name                               string
		price, quantity, pricingUnit, want int64
		valid                              bool
	}{
		{name: "one unit", price: 100, quantity: 1, pricingUnit: 1, want: 100, valid: true},
		{name: "three count", price: 230, quantity: 3, pricingUnit: 1, want: 690, valid: true},
		{name: "explicit packaging", price: 1000, quantity: 4000, pricingUnit: 1000, want: 4000, valid: true},
		{name: "fractional unit unapproved", price: 1000, quantity: 750, pricingUnit: 1000},
		{name: "overflow", price: math.MaxInt64, quantity: 2, pricingUnit: 1},
		{name: "negative amount", price: -50, quantity: 1, pricingUnit: 1},
		{name: "zero unit", price: 100, quantity: 1, pricingUnit: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := independentLineAmount(test.price, test.quantity, test.pricingUnit)
			if test.valid {
				if err != nil || got != test.want {
					t.Fatalf("quoted %d, %v; want %d", got, err, test.want)
				}
			} else if !errors.Is(err, ErrIndependentOrderQuote) {
				t.Fatalf("invalid quote accepted as %d: %v", got, err)
			}
		})
	}
}

func TestIndependentReleaseFailsClosedWithoutAdmittedLegalTerms(t *testing.T) {
	ctx := context.Background()
	if _, err := ReadPublishedIndependentStore(ctx, nil, "store-a", ""); !errors.Is(err, ErrIndependentStorefrontNotPublished) {
		t.Fatalf("public reader must fail closed without authorized legal version: %v", err)
	}
	if _, err := CreateIndependentPickupOrder(ctx, nil, []byte(strings.Repeat("s", 32)), "", validDirectPickup()); !errors.Is(err, ErrIndependentOrderQuote) {
		t.Fatalf("direct order writer must reject unadmitted legal version and unavailable DB: %v", err)
	}
}

func TestIndependentDirectOrderSchemaEnforcesPickupAndCrossStoreLineScope(t *testing.T) {
	records, statements, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != SchemaVersion || records[len(records)-1].Name != "174_independent_storefront_and_direct_orders.sql" {
		t.Fatalf("direct order migration is not the registered canonical last version: %+v", records[len(records)-1])
	}
	sql := statements[len(statements)-1]
	for _, invariant := range []string{
		"independent_direct_order_amount_chk",
		"fulfillment_mode <> 'CUSTOMER_PICKUP' OR merchant_delivery_fee_minor = 0",
		"FOREIGN KEY(order_id,store_id)",
		"FOREIGN KEY(offer_id,store_id,variant_id)",
		"FOREIGN KEY(variant_id,product_id)",
		"guest_capability_hash text NOT NULL UNIQUE",
		"independent_direct_order_idempotency",
		"independent_store_publication_published_chk",
		"independent_store_customer_policies",
		"independent_store_customer_policy_review_chk",
		"hosting_terms_version text NOT NULL",
		"merchant_policy_version text NOT NULL",
		"merchant_policy_snapshot jsonb NOT NULL",
		"independent_direct_order_policy_snapshot_chk",
	} {
		if !strings.Contains(sql, invariant) {
			t.Errorf("missing required independent invariant: %s", invariant)
		}
	}
	for _, forbidden := range []string{"ALTER TABLE dsh.commerce_orders", "DROP CONSTRAINT stores_independent_market_publication_chk", "payment_intent_id", "captain_dispatch_id"} {
		if strings.Contains(sql, forbidden) {
			t.Errorf("independent migration must never modify market path: %s", forbidden)
		}
	}
}

func TestIndependentPublicOfferProjectionExcludesInternalStockAndPublicationFacts(t *testing.T) {
	visible := IndependentPublicOfferPage{Offers: []IndependentPublicOffer{{
		OfferID: "offer-visible", ProductID: "product-visible", ProductName: "Product",
		VariantID: "variant-visible", VariantTitle: "Single", PriceMinor: 600,
		Currency: "YER", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5,
		QuantityStepBaseUnits: 1,
	}}}
	encoded, err := json.Marshal(visible)
	if err != nil {
		t.Fatal(err)
	}
	body := string(encoded)
	if !strings.Contains(body, "offer-visible") || !strings.Contains(body, "\"priceMinor\":600") {
		t.Fatalf("public offer must retain safe consumer fields: %s", body)
	}
	for _, forbidden := range []string{
		"inventoryOnHandBaseUnits", "inventoryReservedBaseUnits",
		"publicationState", "productIdentifiers", "supplier", "productAttributes",
		"partnerActorId", "updatedAt", "version",
	} {
		if strings.Contains(body, forbidden) {
			t.Errorf("independent public DTO leaks internal field %s", forbidden)
		}
	}
}

func TestIndependentSchemaVerifierIncludesAllNewTables(t *testing.T) {
	_, migrations, err := LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	migration := migrations[len(migrations)-1]
	required := []string{
		"dsh.independent_store_publications",
		"dsh.independent_store_customer_policies",
		"dsh.independent_store_customer_policy_idempotency",
		"dsh.independent_store_customer_policy_audit",
		"dsh.independent_store_publication_idempotency",
		"dsh.independent_store_publication_audit",
		"dsh.independent_direct_orders",
		"dsh.independent_direct_order_lines",
		"dsh.independent_direct_order_idempotency",
		"dsh.independent_direct_order_audit",
	}
	for _, table := range required {
		if !strings.Contains(migration, "CREATE TABLE "+table+" (") {
			t.Errorf("migration 174 is missing %s", table)
		}
		found := false
		for _, expected := range requiredTables {
			if expected.name == table {
				found = true
				if len(expected.columns) == 0 || len(expected.constraints) == 0 {
					t.Errorf("schema verify omits critical columns or constraints for %s", table)
				}
			}
		}
		if !found {
			t.Errorf("VerifySchema does not check migration 174 table %s", table)
		}
	}
	for _, requiredSnapshotField := range []string{
		"merchant_policy_snapshot->'cancellationTerms'",
		"merchant_policy_snapshot->'returnsTerms'",
		"merchant_policy_snapshot->'fulfillmentTerms'",
		"merchant_policy_snapshot->'collectionTerms'",
		"COALESCE(btrim(merchant_policy_snapshot->>'cancellationTerms'),'')<>''",
		"COALESCE(btrim(merchant_policy_snapshot->>'returnsTerms'),'')<>''",
		"COALESCE(btrim(merchant_policy_snapshot->>'fulfillmentTerms'),'')<>''",
		"COALESCE(btrim(merchant_policy_snapshot->>'collectionTerms'),'')<>''",
	} {
		if !strings.Contains(migration, requiredSnapshotField) {
			t.Errorf("independent order policy snapshot must reject absent/blank term %s", requiredSnapshotField)
		}
	}
}

func TestIndependentCheckoutRequiresExactDisplayedPolicyAndServerSubtotal(t *testing.T) {
	base := validDirectPickup()
	for _, test := range []struct {
		name           string
		reviewedPolicy string
		serverSubtotal int64
		allowed        bool
	}{
		{name: "same reviewed policy and locked server amount", reviewedPolicy: "v1", serverSubtotal: 1200, allowed: true},
		{name: "review changed after checkout display", reviewedPolicy: "v2", serverSubtotal: 1200},
		{name: "policy no longer exists", reviewedPolicy: "", serverSubtotal: 1200},
		{name: "offer repriced upwards", reviewedPolicy: "v1", serverSubtotal: 1500},
		{name: "offer repriced downwards", reviewedPolicy: "v1", serverSubtotal: 1000},
		{name: "invalid server amount", reviewedPolicy: "v1", serverSubtotal: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := verifyIndependentCustomerConfirmation(base, test.reviewedPolicy, test.serverSubtotal)
			if test.allowed && err != nil {
				t.Fatalf("matching reviewed policy and server price should be permitted: %v", err)
			}
			if !test.allowed && !errors.Is(err, ErrIndependentOrderQuote) {
				t.Fatalf("stale/invalid checkout must fail without inserting: %v", err)
			}
		})
	}
}

func TestIndependentRetryHashBindsDisplayedPolicyAndSubtotal(t *testing.T) {
	original := validDirectPickup()
	_, key, requestHash, err := normalizedIndependentOrder(original)
	if err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*IndependentDirectOrderRequest){
		func(i *IndependentDirectOrderRequest) { i.ExpectedMerchantPolicyVersion = "v2" },
		func(i *IndependentDirectOrderRequest) { i.ExpectedSubtotalMinor = 1500 },
	} {
		changed := original
		mutate(&changed)
		_, newKey, newHash, err := normalizedIndependentOrder(changed)
		if err != nil {
			t.Fatalf("updated expected merchant facts should remain syntactically valid: %v", err)
		}
		if newKey != key || newHash == requestHash {
			t.Fatal("a retry with the same key and different visible policy/price must conflict")
		}
	}
}

func TestIndependentCheckoutUnitOfferMatchesPublishedCatalogSubset(t *testing.T) {
	tests := []struct {
		name            string
		pricingBasis    string
		inventoryPolicy string
		pricingUnit     sql.NullInt64
		allowed         bool
	}{
		{name: "unit available item", pricingBasis: "PER_UNIT", inventoryPolicy: "AVAILABILITY_ONLY", pricingUnit: sql.NullInt64{Int64: 1, Valid: true}, allowed: true},
		{name: "one thousand base units", pricingBasis: "PER_UNIT", inventoryPolicy: "AVAILABILITY_ONLY", pricingUnit: sql.NullInt64{Int64: 1000, Valid: true}},
		{name: "missing unit", pricingBasis: "PER_UNIT", inventoryPolicy: "AVAILABILITY_ONLY"},
		{name: "zero unit", pricingBasis: "PER_UNIT", inventoryPolicy: "AVAILABILITY_ONLY", pricingUnit: sql.NullInt64{Int64: 0, Valid: true}},
		{name: "measured item", pricingBasis: "PER_WEIGHT", inventoryPolicy: "AVAILABILITY_ONLY", pricingUnit: sql.NullInt64{Int64: 1, Valid: true}},
		{name: "stock managed", pricingBasis: "PER_UNIT", inventoryPolicy: "TRACKED", pricingUnit: sql.NullInt64{Int64: 1, Valid: true}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := independentDirectUnitOfferSupported(tt.pricingBasis, tt.inventoryPolicy, tt.pricingUnit)
			if got != tt.allowed {
				t.Fatalf("private checkout must match public direct Catalog, got=%t want=%t", got, tt.allowed)
			}
		})
	}
	if !strings.Contains(independentDirectBuyableOfferSQL, "o.pricing_unit_base_units=1") {
		t.Fatal("public Catalog must use the same single-base-unit pricing rule")
	}
}

func TestIndependentGuestStatusProjectionExcludesPIIAndBearer(t *testing.T) {
	status := IndependentDirectOrderStatus{
		OrderID: "test-order", StoreID: "test-store", State: "SUBMITTED", Version: 1,
	}
	body, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{`"orderId":"test-order"`, `"storeId":"test-store"`, `"state":"SUBMITTED"`, `"version":1`} {
		if !strings.Contains(string(body), required) {
			t.Errorf("guest status DTO missing required safe field %s: %s", required, body)
		}
	}
	for _, forbidden := range []string{"guestPhoneE164", "guestName", "guestCapabilityHash",
		"statusToken", "merchantPolicySnapshot", "paymentMethod", "deliveryAddress", "TotalMinor"} {
		if strings.Contains(string(body), forbidden) {
			t.Errorf("guest status response unexpectedly includes %s: %s", forbidden, body)
		}
	}
}

func TestIndependentGuestStatusCapabilityRejectsMalformedBeforeSQL(t *testing.T) {
	validToken := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("Q", sha256.Size)))
	if len(validToken) != 43 || !independentGuestStatusLookupValid("store-a", "order-a", validToken) {
		t.Fatal("DSH-issued 32-byte HMAC status token should pass canonical format validation")
	}
	for _, test := range []struct {
		name, storeID, orderID, token string
	}{
		{"blank store", "", "order-a", validToken},
		{"blank order", "store-a", "", validToken},
		{"leading Store whitespace", " store-a", "order-a", validToken},
		{"trailing Order whitespace", "store-a", "order-a ", validToken},
		{"oversized Store", strings.Repeat("s", 129), "order-a", validToken},
		{"oversized Order", "store-a", strings.Repeat("o", 129), validToken},
		{"embedded NUL", "store\x00a", "order-a", validToken},
		{"invalid UTF8 Store", string([]byte{0xff}), "order-a", validToken},
		{"invalid UTF8 Order", "store-a", string([]byte{0xfe}), validToken},
		{"line break", "store-a", "order\na", validToken},
		{"empty capability", "store-a", "order-a", ""},
		{"truncated capability", "store-a", "order-a", validToken[:42]},
		{"padded capability", "store-a", "order-a", validToken + "="},
		{"non-base64url capability", "store-a", "order-a", "!" + validToken[1:]},
		{"overlong capability", "store-a", "order-a", strings.Repeat("A", 128)},
	} {
		t.Run(test.name, func(t *testing.T) {
			if independentGuestStatusLookupValid(test.storeID, test.orderID, test.token) {
				t.Fatal("invalid guest status request passed the pre-database guard")
			}
			if _, err := ReadIndependentDirectOrderStatus(context.Background(), nil, test.storeID, test.orderID, test.token); !errors.Is(err, ErrIndependentOrderUnavailable) {
				t.Fatalf("public status must fail closed without database: %v", err)
			}
		})
	}
}

func TestIndependentOrderReplayDoesNotReissueRotatedOrExpiredBearer(t *testing.T) {
	originalSecret := []byte(strings.Repeat("A", 32))
	rotatedSecret := []byte(strings.Repeat("B", 32))
	key := strings.Repeat("d", 64)
	originalToken, storedHash, err := independentGuestCapability(originalSecret, key)
	if err != nil {
		t.Fatal(err)
	}
	rotatedToken, rotatedHash, err := independentGuestCapability(rotatedSecret, key)
	if err != nil {
		t.Fatal(err)
	}
	if originalToken == rotatedToken || storedHash == rotatedHash {
		t.Fatal("secret rotation must change the derived bearer")
	}
	now := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name                       string
		token, hash, persistedHash string
		expires                    time.Time
		want                       string
	}{
		{"unchanged original secret", originalToken, storedHash, storedHash, now.Add(15 * time.Minute), originalToken},
		{"rotated server secret", rotatedToken, rotatedHash, storedHash, now.Add(15 * time.Minute), ""},
		{"expired original secret", originalToken, storedHash, storedHash, now.Add(-time.Second), ""},
		{"exact expiry", originalToken, storedHash, storedHash, now, ""},
		{"unmatched persisted hash", originalToken, storedHash, strings.Repeat("0", 64), now.Add(15 * time.Minute), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := replayableIndependentGuestStatusToken(tc.token, tc.hash, tc.persistedHash, tc.expires, now)
			if got != tc.want {
				t.Fatalf("incorrect replay status bearer: got length=%d want length=%d", len(got), len(tc.want))
			}
		})
	}
}
