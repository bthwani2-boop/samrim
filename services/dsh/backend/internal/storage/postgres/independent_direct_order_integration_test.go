package postgres_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// This test is NOT allowed to use the ordinary DSH application database.
// Its only write target is a disposable database created by withFreshDatabase.
// Without the exact isolated QA authorization it is NOT_RUN, not PASS.
func isolatedIndependentOrderQA(t *testing.T) string {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if os.Getenv("BTHWANI_DSH_QA_ISOLATED") != "1" || raw == "" {
		t.Skip("NOT_RUN: dedicated isolated DSH QA is not authorized/available")
	}
	target, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	name := strings.TrimPrefix(target.Path, "/")
	if target.Scheme != "postgres" || target.Hostname() != "127.0.0.1" ||
		target.Port() != "19432" || name != "dsh_proof" ||
		target.User == nil || target.User.Username() != "postgres" ||
		target.RawQuery != "sslmode=disable" || target.Fragment != "" {
		t.Fatal("refuse independent direct order QA against an unrecognized or shared PostgreSQL target")
	}
	return raw
}

func TestIndependentDirectOrderIsolatedPersistenceGuards(t *testing.T) {
	raw := isolatedIndependentOrderQA(t)
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
		const storeA, storeB, ownerA = "direct-integration-a", "direct-integration-b", "direct-owner-a"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeA, PartnerActorID: ownerA, Name: "Store A"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeB, PartnerActorID: "direct-owner-b", Name: "Store B"})
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE' WHERE id=$1`, storeA); err != nil {
			t.Fatal(err)
		}
		state, version, err := postgres.IndependentStorePublicationForOwner(ctx, db, storeA, ownerA)
		if err != nil || state != "DRAFT" || version != 1 {
			t.Fatalf("canonical unseeded independent Store must have safe DRAFT readback: %q v%d %v", state, version, err)
		}
		if _, _, err := postgres.IndependentStorePublicationForOwner(ctx, db, storeA, "other-owner"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("cross-owner independent preview should fail closed: %v", err)
		}
		if _, _, err := postgres.IndependentStorePublicationForOwner(ctx, db, storeB, "direct-owner-b"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("market Store must not obtain independent publication readback: %v", err)
		}
		// Parse and execute the independent public Store's full SQL, including
		// the same-statement rights-attested media joins, against PostgreSQL.
		// A draft Store without a reviewed publication must fail closed.
		if _, err := postgres.ReadPublishedIndependentStore(ctx, db, storeA, "unreleased-qa-only"); !errors.Is(err, postgres.ErrIndependentStorefrontNotPublished) {
			t.Fatalf("independent public Store must remain unpublished in isolated QA: %v", err)
		}
		// Public Catalog also uses a read-only REPEATABLE READ transaction to
		// evaluate authorization, paginate Offers, and hydrate media. A draft
		// must fail closed even if its internal Catalog already has products.
		if _, err := postgres.ListPublishedIndependentOffers(ctx, db, storeA, "unreleased-qa-only", 20, ""); !errors.Is(err, postgres.ErrIndependentStorefrontNotPublished) {
			t.Fatalf("independent public Catalog must not expose draft Store offers: %v", err)
		}

		// Owner-only draft policy writer is a separate, non-publication flow.
		initialPolicy, err := postgres.ReadIndependentCustomerPolicyForOwner(ctx, db, storeA, ownerA)
		if err != nil || initialPolicy.Version != 0 || initialPolicy.ReviewState != "NOT_CHECKED" {
			t.Fatalf("fresh independent Store must read an unpublished customer policy v0: %+v err=%v", initialPolicy, err)
		}
		if _, err := postgres.ReadIndependentCustomerPolicyForOwner(ctx, db, storeA, "foreign-owner"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("private merchant policy read leaked across owners: %v", err)
		}
		policyInput := postgres.IndependentCustomerPolicyDraftInput{
			ExpectedVersion: 0, CancellationTerms: "Cancel with the merchant before pickup",
			ReturnsTerms: "The merchant reviews returns", FulfillmentTerms: "Collect at the Store",
			CollectionTerms: "Pay the merchant directly at pickup",
		}
		policyID := "owner-policy-attempt-0001"
		policy1, replay, err := postgres.SaveIndependentCustomerPolicyDraftForOwner(
			ctx, db, storeA, ownerA, policyInput, policyID, "qa-policy-corr-1")
		if err != nil || replay || policy1.Version != 1 || policy1.PolicyVersion != "v1" || policy1.ReviewState != "NOT_CHECKED" {
			t.Fatalf("first merchant policy draft not saved correctly: %+v replay=%v err=%v", policy1, replay, err)
		}
		again, replay, err := postgres.SaveIndependentCustomerPolicyDraftForOwner(
			ctx, db, storeA, ownerA, policyInput, policyID, "qa-policy-corr-1")
		if err != nil || !replay || again.Version != policy1.Version || again.PolicyVersion != policy1.PolicyVersion {
			t.Fatalf("identical merchant policy retry must return the same recorded result: %+v replay=%v err=%v", again, replay, err)
		}
		modifiedPolicy := policyInput
		modifiedPolicy.ReturnsTerms = "Changed terms, not the same request"
		if _, _, err := postgres.SaveIndependentCustomerPolicyDraftForOwner(
			ctx, db, storeA, ownerA, modifiedPolicy, policyID, "qa-policy-corr-1"); !errors.Is(err, postgres.ErrIndependentCustomerPolicyConflict) {
			t.Fatalf("same key with changed policy must conflict: %v", err)
		}
		if _, _, err := postgres.SaveIndependentCustomerPolicyDraftForOwner(
			ctx, db, storeA, "foreign-owner", policyInput, "foreign-policy-attempt-001", "qa-policy-corr-2"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("foreign owner must never mutate merchant policy: %v", err)
		}
		if _, _, err := postgres.SaveIndependentCustomerPolicyDraftForOwner(
			ctx, db, storeB, "direct-owner-b", policyInput, "market-policy-attempt-001", "qa-policy-corr-3"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("market Store must not write an independent merchant policy: %v", err)
		}
		if _, _, err := postgres.SaveIndependentCustomerPolicyDraftForOwner(
			ctx, db, storeA, ownerA, policyInput, "stale-policy-attempt-001", "qa-policy-corr-4"); !errors.Is(err, postgres.ErrIndependentCustomerPolicyVersion) {
			t.Fatalf("stale policy update must fail with a version conflict: %v", err)
		}
		// Fixture-only simulation of operator review: changing the merchant's
		// draft must revoke that review, not silently keep the Store published.
		if _, err := db.ExecContext(ctx, `UPDATE dsh.independent_store_customer_policies
			SET review_state='PASSED',reviewed_by_actor_id='qa:operator',
				published_at=clock_timestamp() WHERE store_id=$1`, storeA); err != nil {
			t.Fatal(err)
		}
		modifiedPolicy.ExpectedVersion = 1
		policy2, replay, err := postgres.SaveIndependentCustomerPolicyDraftForOwner(
			ctx, db, storeA, ownerA, modifiedPolicy, "changed-policy-attempt-001", "qa-policy-corr-5")
		if err != nil || replay || policy2.Version != 2 || policy2.ReviewState != "NOT_CHECKED" {
			t.Fatalf("updated merchant policy should revoke review: %+v replay=%v err=%v", policy2, replay, err)
		}
		var reviewState string
		var publishedAt sql.NullTime
		if err := db.QueryRowContext(ctx, `SELECT review_state,published_at
			FROM dsh.independent_store_customer_policies WHERE store_id=$1`, storeA).
			Scan(&reviewState, &publishedAt); err != nil || reviewState != "NOT_CHECKED" || publishedAt.Valid {
			t.Fatalf("merchant policy draft did not revoke prior publication: state=%s published=%v err=%v", reviewState, publishedAt, err)
		}
		// Real simultaneous retries against one disposable PostgreSQL Store:
		// row locking and the idempotency owner must create one version only.
		concurrentInput := modifiedPolicy
		concurrentInput.ExpectedVersion = 2
		type policyResult struct {
			record postgres.IndependentCustomerPolicyRecord
			replay bool
			err    error
		}
		results := make([]policyResult, 2)
		var both sync.WaitGroup
		for i := 0; i < 2; i++ {
			both.Add(1)
			go func(i int) {
				defer both.Done()
				results[i].record, results[i].replay, results[i].err =
					postgres.SaveIndependentCustomerPolicyDraftForOwner(ctx, db, storeA, ownerA,
						concurrentInput, "concurrent-policy-attempt-001", "qa-policy-corr-6")
			}(i)
		}
		both.Wait()
		for i := range results {
			if results[i].err != nil || results[i].record.Version != 3 || results[i].record.PolicyVersion != "v3" {
				t.Fatalf("concurrent merchant policy retry %d failed: %+v", i, results[i])
			}
		}
		if results[0].replay == results[1].replay {
			t.Fatalf("one merchant policy attempt should create, the second should replay: %+v", results)
		}
		var policyAuditCount int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.independent_store_customer_policy_audit
			WHERE store_id=$1`, storeA).Scan(&policyAuditCount); err != nil || policyAuditCount != 3 {
			t.Fatalf("merchant policy audit must contain exactly three durable changes: count=%d err=%v", policyAuditCount, err)
		}
		productInput := postgres.CatalogProductInput{VerticalID: storeB + "-vertical", Scope: "STORE_SCOPED", StoreID: storeB, CanonicalName: "Test Offer B", VariantTitle: "Unit", MeasurementKind: "DISCRETE", BaseUnit: "COUNT"}
		product, err := postgres.CreateCatalogProduct(ctx, db, productInput, "direct-b-product-create", postgres.HashCatalogProductCreateRequest(productInput), "direct-owner-b", "direct-product-correlation")
		if err != nil {
			t.Fatal(err)
		}
		offerInput := postgres.CatalogOfferInput{StoreID: storeB, VariantID: product.Product.Variants[0].ID, PriceMinor: 600,
			QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1,
			PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY"}
		offer, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "direct-b-offer-create", postgres.HashCatalogOfferCreateRequest(offerInput), "direct-owner-b", "direct-offer-correlation")
		if err != nil {
			t.Fatal(err)
		}
		// This synthetic order is fixture-only and does NOT prove public checkout.
		insert := `INSERT INTO dsh.independent_direct_orders
			(id,store_id,publication_version,store_version,fulfillment_mode,
			guest_name,guest_phone_e164,hosting_terms_version,merchant_policy_version,
			merchant_policy_snapshot,subtotal_amount_minor,
			merchant_delivery_fee_minor,total_amount_minor,guest_capability_hash,guest_capability_expires_at)
			VALUES($1,$2,1,1,'CUSTOMER_PICKUP','Guest Buyer','+967700001122',
			'unreleased-hosting-terms','unreleased-merchant-policy',
			'{"cancellationTerms":"test only","returnsTerms":"test only","fulfillmentTerms":"test only","collectionTerms":"test only"}'::jsonb,
			600,$3,$4,$5,clock_timestamp()+interval '10 minutes')`
		if _, err := db.ExecContext(ctx, insert, "invalid-pickup-fee", storeA, 50, 650, strings.Repeat("a", 64)); err == nil {
			t.Fatal("pickup with merchant delivery fee must fail DB CHECK")
		}
		if _, err := db.ExecContext(ctx, insert, "valid-test-order", storeA, 0, 600, strings.Repeat("b", 64)); err != nil {
			t.Fatalf("insert synthetic QA-only order: %v", err)
		}
		// Prove the schema rejects a forged line price even when all Store,
		// Offer, Variant and Product foreign keys are valid. These are
		// disposable QA-only fixtures, not a bypass of the DSH order writer.
		productAInput := postgres.CatalogProductInput{VerticalID: storeA + "-vertical",
			Scope: "STORE_SCOPED", StoreID: storeA, CanonicalName: "Test Offer A",
			VariantTitle: "Unit", MeasurementKind: "DISCRETE", BaseUnit: "COUNT"}
		productA, err := postgres.CreateCatalogProduct(ctx, db, productAInput,
			"direct-a-product-create", postgres.HashCatalogProductCreateRequest(productAInput),
			ownerA, "direct-a-product-correlation")
		if err != nil {
			t.Fatal(err)
		}
		offerAInput := postgres.CatalogOfferInput{StoreID: storeA,
			VariantID: productA.Product.Variants[0].ID, PriceMinor: 600,
			QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5,
			QuantityStepBaseUnits: 1, PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1,
			InventoryPolicy: "AVAILABILITY_ONLY"}
		offerA, err := postgres.CreateCatalogOffer(ctx, db, offerAInput,
			"direct-a-offer-create", postgres.HashCatalogOfferCreateRequest(offerAInput),
			ownerA, "direct-a-offer-correlation")
		if err != nil {
			t.Fatal(err)
		}
		lineInsert := `INSERT INTO dsh.independent_direct_order_lines
			(order_id,store_id,offer_id,product_id,variant_id,product_name,variant_title,
			 quantity_base_units,pricing_unit_base_units,unit_price_minor,line_amount_minor)
			VALUES($1,$2,$3,$4,$5,'Test Offer A','Unit',1,1,600,$6)`
		lineArgs := []any{"valid-test-order", storeA, offerA.Offer.ID,
			productA.Product.ID, productA.Product.Variants[0].ID}
		if _, err := db.ExecContext(ctx, lineInsert,
			append(append([]any{}, lineArgs...), 500)...); err == nil {
			t.Fatal("database accepted mathematically false independent order line charge")
		}
		if _, err := db.ExecContext(ctx, lineInsert,
			append(append([]any{}, lineArgs...), 600)...); err != nil {
			t.Fatalf("database rejected exact independently priced line: %v", err)
		}

		// A durable idempotency record belongs to the historical request,
		// not to the current server HMAC secret. Simulate the original
		// committed receipt inside this disposable database, then verify
		// that rotating the signing secret does not create an Order or
		// reissue a bearer not matching the persisted capability hash.
		// This is a replay-only fixture, NOT proof of public checkout.
		replayAttempt := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("K", 32)))
		replayRequest := postgres.IndependentDirectOrderRequest{
			StoreID: storeA, IdempotencyKey: replayAttempt,
			GuestName: "Guest Buyer", GuestPhoneE164: "+967700001122",
			ExpectedMerchantPolicyVersion: "v3", ExpectedSubtotalMinor: 600,
			FulfillmentMode: "CUSTOMER_PICKUP",
			Lines:           []postgres.IndependentDirectOrderLineRequest{{OfferID: "synthetic-qa-only-offer", QuantityBaseUnits: 1}},
		}
		replayFacts, err := json.Marshal(replayRequest)
		if err != nil {
			t.Fatal(err)
		}
		idempotencyDigest := sha256.Sum256([]byte("dsh:independent-direct-order:v1:" + replayAttempt))
		idempotencyHash := hex.EncodeToString(idempotencyDigest[:])
		replayRequestDigest := sha256.Sum256(replayFacts)
		oldSecret := []byte(strings.Repeat("M", 32))
		rotatedSecret := []byte(strings.Repeat("N", 32))
		mac := hmac.New(sha256.New, oldSecret)
		_, _ = mac.Write([]byte("dsh:independent-direct-order:status:v1:" + idempotencyHash))
		oldBearer := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
		oldBearerDigest := sha256.Sum256([]byte(oldBearer))
		if _, err := db.ExecContext(ctx, `UPDATE dsh.independent_direct_orders SET guest_capability_hash=$2 WHERE id=$1`,
			"valid-test-order", hex.EncodeToString(oldBearerDigest[:])); err != nil {
			t.Fatalf("attach replay-only synthetic capability: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.independent_direct_order_idempotency
			(key_hash,request_hash,store_id,order_id) VALUES($1,$2,$3,$4)`,
			idempotencyHash, hex.EncodeToString(replayRequestDigest[:]), storeA, "valid-test-order"); err != nil {
			t.Fatalf("attach replay-only synthetic attempt: %v", err)
		}
		originalReplay, err := postgres.CreateIndependentPickupOrder(ctx, db, oldSecret,
			"qa-server-terms-version", replayRequest)
		if err != nil || !originalReplay.Replayed || originalReplay.OrderID != "valid-test-order" ||
			originalReplay.StatusToken != oldBearer || originalReplay.TotalMinor != 600 {
			t.Fatalf("unchanged secret must return the original durable receipt and bearer: %+v err=%v", originalReplay, err)
		}
		rotatedReplay, err := postgres.CreateIndependentPickupOrder(ctx, db, rotatedSecret,
			"qa-server-terms-version", replayRequest)
		if err != nil || !rotatedReplay.Replayed || rotatedReplay.OrderID != originalReplay.OrderID ||
			rotatedReplay.StatusToken != "" || rotatedReplay.TotalMinor != originalReplay.TotalMinor {
			t.Fatalf("rotated secret must return the same receipt without minting a bearer: %+v err=%v", rotatedReplay, err)
		}
		var replayAuditCount int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.independent_direct_order_audit
			WHERE order_id='valid-test-order'`).Scan(&replayAuditCount); err != nil || replayAuditCount != 0 {
			t.Fatalf("idempotent retries must not create Order audit events: count=%d err=%v", replayAuditCount, err)
		}

		// This is a synthetic disposable-DB guest capability fixture, not an
		// authenticated customer or HTTP order flow. Only hashed tokens are
		// persisted. The reader must return state alone, isolated by Store
		// and expiry, and must never expose the synthetic buyer's phone.
		validGuestToken := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("Q", sha256.Size)))
		validDigest := sha256.Sum256([]byte(validGuestToken))
		if _, err := db.ExecContext(ctx, `UPDATE dsh.independent_direct_orders
			SET guest_capability_hash=$2 WHERE id=$1`, "valid-test-order",
			hex.EncodeToString(validDigest[:])); err != nil {
			t.Fatalf("scope synthetic guest token to the disposable order: %v", err)
		}
		status, err := postgres.ReadIndependentDirectOrderStatus(ctx, db, storeA, "valid-test-order", validGuestToken)
		if err != nil || status.OrderID != "valid-test-order" || status.StoreID != storeA ||
			status.State != "SUBMITTED" || status.Version != 1 {
			t.Fatalf("valid synthetic guest token failed scoped state read: %+v err=%v", status, err)
		}
		projection, err := json.Marshal(status)
		if err != nil {
			t.Fatal(err)
		}
		for _, secretField := range []string{"Guest Buyer", "+967700001122", "guestName",
			"guestPhoneE164", "deliveryAddress", "statusToken", "merchantPolicySnapshot"} {
			if strings.Contains(string(projection), secretField) {
				t.Fatalf("guest public status projection leaked %s: %s", secretField, projection)
			}
		}
		for _, invalid := range []struct{ name, store, order, token string }{
			{name: "wrong store", store: storeB, order: "valid-test-order", token: validGuestToken},
			{name: "wrong order", store: storeA, order: "another-order", token: validGuestToken},
			{name: "wrong token", store: storeA, order: "valid-test-order", token: strings.Repeat("X", 60)},
		} {
			if _, err := postgres.ReadIndependentDirectOrderStatus(ctx, db,
				invalid.store, invalid.order, invalid.token); !errors.Is(err, postgres.ErrIndependentOrderUnavailable) {
				t.Fatalf("guest status unexpectedly accessible for %s: %v", invalid.name, err)
			}
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.independent_direct_orders
			SET guest_capability_expires_at=clock_timestamp()-interval '1 second'
			WHERE id=$1`, "valid-test-order"); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.ReadIndependentDirectOrderStatus(ctx, db, storeA,
			"valid-test-order", validGuestToken); !errors.Is(err, postgres.ErrIndependentOrderUnavailable) {
			t.Fatalf("expired guest token must not recover status: %v", err)
		}
		// A merchant policy snapshot with no actual cancellation/returns terms
		// must be rejected even if a direct SQL writer bypasses DSH validation.
		if _, err := db.ExecContext(ctx, `UPDATE dsh.independent_direct_orders
			SET merchant_policy_snapshot='{}'::jsonb WHERE id=$1`, "valid-test-order"); err == nil {
			t.Fatal("empty merchant policy snapshot bypassed DB policy CHECK")
		}
		_, err = db.ExecContext(ctx, `INSERT INTO dsh.independent_direct_order_lines
			(order_id,store_id,offer_id,product_id,variant_id,product_name,variant_title,
			 quantity_base_units,pricing_unit_base_units,unit_price_minor,line_amount_minor)
			VALUES($1,$2,$3,$4,$5,'Foreign Product','Unit',1,1,600,600)`,
			"valid-test-order", storeA, offer.Offer.ID, product.Product.ID, product.Product.Variants[0].ID)
		if err == nil {
			t.Fatal("a line from Store B must never be attached to a Direct Order owned by Store A")
		}
		// Persistence witness: failed cross-Store insert did not contaminate
		// the one legitimate line or the order's immutable subtotal.
		var count int
		var lineSum int64
		if err := db.QueryRowContext(ctx, `SELECT count(*),COALESCE(sum(line_amount_minor),0)
			FROM dsh.independent_direct_order_lines WHERE order_id=$1`, "valid-test-order").
			Scan(&count, &lineSum); err != nil || count != 1 || lineSum != 600 {
			t.Fatalf("cross-Store or forged-line injection changed persisted items: count=%d sum=%d err=%v", count, lineSum, err)
		}
		// The original marketplace publication law must remain unchanged.
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET publication_state='published' WHERE id=$1`, storeA); err == nil {
			t.Fatal("independent Store must not be admitted to legacy marketplace publication")
		}
		// End-to-end DSH HTTP -> synthetic Identity session -> real isolated
		// PostgreSQL positive owner draft write/replay and negative IDOR.
		// No public publication, service cutover or financial side effect.
		exerciseIndependentPolicyHTTPOnIsolatedDB(t, ctx, db, storeA, storeB, ownerA)
	}, 5*time.Minute)
}
