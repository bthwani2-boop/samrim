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
	"github.com/lib/pq"
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
		// A private Preview must bind owner, separate publication, Store media
		// and Catalog to one repeatable-read transaction on actual PostGIS.
		previewStore, previewState, previewPage, err := postgres.ReadIndependentPreviewSnapshotForOwner(
			ctx, db, storeA, ownerA, 20, "")
		if err != nil || previewStore.ID != storeA || previewStore.RelationModel != "INDEPENDENT_STORE" ||
			previewState != "DRAFT" || len(previewPage.Offers) != 0 {
			t.Fatalf("independent owner preview snapshot must remain an owned draft: store=%+v publication=%q page=%+v err=%v",
				previewStore, previewState, previewPage, err)
		}
		if _, _, _, err := postgres.ReadIndependentPreviewSnapshotForOwner(
			ctx, db, storeA, "other-owner", 20, ""); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("foreign owner must not access independent Catalog snapshot: %v", err)
		}
		if _, _, _, err := postgres.ReadIndependentPreviewSnapshotForOwner(
			ctx, db, storeB, "direct-owner-b", 20, ""); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("marketplace Store must not access independent owner preview snapshot: %v", err)
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
		// A marketplace Store must never create a direct Order, even when the
		// caller bypasses the Go Store-model check and uses valid Order facts.
		if _, err := db.ExecContext(ctx, insert, "market-model-forbidden", storeB, 0, 600, strings.Repeat("c", 64)); err == nil {
			t.Fatal("marketplace Store bypassed the direct Order insertion guard")
		}
		var marketDirectCount int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.independent_direct_orders WHERE id='market-model-forbidden'`).
			Scan(&marketDirectCount); err != nil || marketDirectCount != 0 {
			t.Fatalf("marketplace Order denial was not durable: count=%d err=%v", marketDirectCount, err)
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
		// A previously accepted attempt key never becomes reusable by a
		// different Store, even when both Stores are currently unlisted.
		crossStoreReplay := replayRequest
		crossStoreReplay.StoreID = storeB
		if _, err := postgres.CreateIndependentPickupOrder(ctx, db, oldSecret,
			"qa-server-terms-version", crossStoreReplay); !errors.Is(err, postgres.ErrIndependentOrderConflict) {
			t.Fatalf("historical idempotency key must reject another Store without a new Order: %v", err)
		}
		changedReplay := replayRequest
		changedReplay.ExpectedSubtotalMinor = 700
		if _, err := postgres.CreateIndependentPickupOrder(ctx, db, oldSecret,
			"qa-server-terms-version", changedReplay); !errors.Is(err, postgres.ErrIndependentOrderConflict) {
			t.Fatalf("same historical key with different checkout amount must conflict: %v", err)
		}
		var historicalKeyCount int
		if err := db.QueryRowContext(ctx,
			`SELECT count(*) FROM dsh.independent_direct_order_idempotency WHERE key_hash=$1 AND store_id=$2 AND order_id=$3`,
			idempotencyHash, storeA, "valid-test-order").Scan(&historicalKeyCount); err != nil || historicalKeyCount != 1 {
			t.Fatalf("cross-Store/changed-payload retries must preserve original idempotency mapping: count=%d err=%v", historicalKeyCount, err)
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

		// A1-P1: current draft must reject competing attempts; the durable
		// idempotency key remains unique across synthetic concurrent SQL
		// transactions. This is NOT an approved customer checkout test.
		exerciseIndependentDirectOrderConcurrentDraftAndIdempotencySQL(
			t, ctx, db, storeA, storeB, offerA.Offer.ID,
			productA.Product.ID, productA.Product.Variants[0].ID)

		t.Run("reviewed pickup persists one order and rejects stale confirmation", func(t *testing.T) {
			exerciseIndependentPickupWriter(t, ctx, db, storeA, ownerA, offerA.Offer.ID, offerA.Offer.Version)
		})

		// Only the *new* direct Order is gated by the current relationship.
		// A QA-only relation flip must not delete or rewrite an older Order;
		// this is a persistence invariant, not a released conversion workflow.
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='BTHWANI_PARTNER' WHERE id=$1`, storeA); err != nil {
			t.Fatal(err)
		}
		var historicState string
		if err := db.QueryRowContext(ctx, `SELECT state FROM dsh.independent_direct_orders WHERE id=$1 AND store_id=$2`,
			"valid-test-order", storeA).Scan(&historicState); err != nil || historicState != "SUBMITTED" {
			t.Fatalf("relation change must preserve historic merchant-direct Order: state=%q err=%v", historicState, err)
		}
		if _, err := db.ExecContext(ctx, insert, "after-relation-change-forbidden", storeA, 0, 600,
			strings.Repeat("d", 64)); err == nil {
			t.Fatal("a newly marketplace Store must no longer create direct Orders")
		}
	}, 5*time.Minute)
}

func exerciseIndependentPickupWriter(t *testing.T, ctx context.Context, db *sql.DB, storeID, ownerID, offerID string, offerVersion int) {
	t.Helper()
	const termsVersion, policyVersion = "qa-hosting-v1", "qa-merchant-v1"
	// Only this disposable database has synthetic reviewed publication and media.
	// The Order, lines, idempotency key and audit must all come from the DSH writer.
	for _, fixture := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('direct-qa-city','QA City',true)`, nil},
		{`UPDATE dsh.stores SET service_city_id='direct-qa-city',fulfillment_modes=ARRAY['CUSTOMER_PICKUP'] WHERE id=$1`, []any{storeID}},
		{`INSERT INTO dsh.independent_store_publications(
			store_id,state,review_state,terms_version,terms_accepted_by_actor_id,terms_accepted_at,published_at)
			VALUES($1,'PUBLISHED_INDEPENDENT','PASSED',$2,$3,clock_timestamp(),clock_timestamp())`, []any{storeID, termsVersion, ownerID}},
		{`UPDATE dsh.independent_store_customer_policies SET policy_version=$2, review_state='PASSED',
			reviewed_by_actor_id='qa-reviewer',published_at=clock_timestamp() WHERE store_id=$1`, []any{storeID, policyVersion}},
		{`INSERT INTO dsh.store_profile_media_assets(
			id,store_id,idempotency_key,request_hash,expected_case_version,object_key,uri,content_sha256,content_type,
			byte_size,media_role,state,attached_at,creator,source_description,rights_statement,rights_attested_by_actor_id,rights_attested_at)
			SELECT 'direct-qa-' || role,$1,'direct-qa-' || role,repeat('a',64),1,'direct-qa-' || role,
			       'https://fixture.invalid/' || role,repeat('a',64),'image/png',1,role,'active',clock_timestamp(),
			       'QA fixture','QA fixture','QA test rights',$2,clock_timestamp()
			FROM (VALUES ('primary'),('cover')) AS media(role)`, []any{storeID, ownerID}},
		{`INSERT INTO dsh.store_operational_availability(store_id,schedule_mode,schedule_timezone,weekly_schedule,paused,
			unavailable_fulfillment_modes,version,updated_by_actor_id)
			VALUES($1,'ALWAYS_OPEN','Asia/Aden','[]'::jsonb,false,ARRAY[]::text[],1,'system:lazy-initialize')
			ON CONFLICT(store_id) DO UPDATE SET schedule_mode=EXCLUDED.schedule_mode,
				version=EXCLUDED.version,updated_by_actor_id=EXCLUDED.updated_by_actor_id`, []any{storeID}},
	} {
		result, err := db.ExecContext(ctx, fixture.query, fixture.args...)
		if err != nil {
			t.Fatal(err)
		}
		if rows, err := result.RowsAffected(); err != nil || rows == 0 {
			t.Fatalf("reviewed pickup fixture did not write its expected rows: %d %v", rows, err)
		}
	}
	if _, _, err := postgres.UpdateStorePublicContactForOwner(ctx, db, storeID, ownerID,
		postgres.StorePublicContactInput{PhoneE164: "+967700001234"}, "direct-qa-contact", "direct-qa-contact-corr"); err != nil {
		t.Fatal(err)
	}
	offer := postgres.CatalogOfferUpdateInput{
		PriceMinor: 600, Availability: true, PublicationState: "published",
		QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1,
		PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY",
	}
	if _, err := postgres.UpdateCatalogOffer(ctx, db, offerID, offer, offerVersion, "direct-qa-offer",
		postgres.HashCatalogOfferUpdateRequest(offerID, offer, offerVersion), ownerID, "direct-qa-offer-corr"); err != nil {
		t.Fatal(err)
	}
	storefront, err := postgres.ReadPublishedIndependentStore(ctx, db, storeID, termsVersion)
	if err != nil || storefront.StoreID != storeID || storefront.MerchantPolicyVersion != policyVersion {
		t.Fatalf("synthetic reviewed storefront must expose the correct Store and policy: %+v %v", storefront, err)
	}
	catalog, err := postgres.ListPublishedIndependentOffers(ctx, db, storeID, termsVersion, 20, "")
	if err != nil || len(catalog.Offers) != 1 || catalog.Offers[0].OfferID != offerID {
		t.Fatalf("direct catalog must expose the exact buyable offer: %+v %v", catalog, err)
	}
	request := postgres.IndependentDirectOrderRequest{
		StoreID: storeID, IdempotencyKey: base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("Q", 32))),
		GuestName: "QA Pickup Buyer", GuestPhoneE164: "+967700001235",
		ExpectedMerchantPolicyVersion: policyVersion, ExpectedSubtotalMinor: 1200, FulfillmentMode: "CUSTOMER_PICKUP",
		Lines: []postgres.IndependentDirectOrderLineRequest{{OfferID: offerID, QuantityBaseUnits: 2}},
	}
	secret := []byte(strings.Repeat("Y", 32))
	if _, err := postgres.CreateIndependentPickupOrder(ctx, db, secret, termsVersion, request); !errors.Is(err, postgres.ErrIndependentOrderUnavailable) {
		t.Fatalf("legacy system-initialized opening must not admit pickup: %v", err)
	}
	availability, _, err := postgres.UpdateStoreOperationalAvailability(ctx, db, postgres.UpdateStoreOperationalAvailabilityInput{
		StoreID: storeID, ScheduleMode: "ALWAYS_OPEN", ExpectedVersion: 1, ActingActorID: ownerID,
		AuthoritySource: "STORE_OWNER", IdempotencyKey: "direct-qa-hours", CorrelationID: "direct-qa-hours-corr",
	})
	if err != nil || availability.Version != 2 || availability.UpdatedByActorID != ownerID {
		t.Fatalf("explicit pickup hours must persist under the Store owner: %+v %v", availability, err)
	}
	stale := request
	stale.ExpectedSubtotalMinor++
	if _, err := postgres.CreateIndependentPickupOrder(ctx, db, secret, termsVersion, stale); !errors.Is(err, postgres.ErrIndependentOrderQuote) {
		t.Fatalf("stale quote must not spend the key or create an Order: %v", err)
	}
	first, err := postgres.CreateIndependentPickupOrder(ctx, db, secret, termsVersion, request)
	if err != nil || first.Replayed || first.OrderID == "" || first.State != "SUBMITTED" || first.TotalMinor != 1200 {
		t.Fatalf("internal pickup confirmation must persist exactly the quoted Order: %+v %v", first, err)
	}
	replay, err := postgres.CreateIndependentPickupOrder(ctx, db, secret, termsVersion, request)
	if err != nil || !replay.Replayed || replay.OrderID != first.OrderID || replay.StatusToken != first.StatusToken {
		t.Fatalf("retry must recover the committed Order and original status capability: %+v %v", replay, err)
	}
	status, err := postgres.ReadIndependentDirectOrderStatus(ctx, db, storeID, first.OrderID, first.StatusToken)
	if err != nil || status.OrderID != first.OrderID || status.Version != 1 {
		t.Fatalf("guest capability did not read committed canonical state: %+v %v", status, err)
	}
	var orders, lines, audit int
	if err := db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM dsh.independent_direct_orders WHERE guest_name=$1),
		(SELECT count(*) FROM dsh.independent_direct_order_lines WHERE order_id=$2 AND quantity_base_units=2 AND line_amount_minor=1200),
		(SELECT count(*) FROM dsh.independent_direct_order_audit WHERE order_id=$2 AND to_state='SUBMITTED')`,
		request.GuestName, first.OrderID).Scan(&orders, &lines, &audit); err != nil || orders != 1 || lines != 1 || audit != 1 {
		t.Fatalf("unexpected persisted order effects: orders=%d lines=%d audit=%d err=%v", orders, lines, audit, err)
	}
}

// exerciseIndependentDirectOrderConcurrentDraftAndIdempotencySQL verifies the
// only lawful claim possible before operator-reviewed publication is admitted:
// concurrent guests cannot write to a draft, and a disposable SQL transaction
// cannot persist duplicate idempotency keys or an orphaned losing Order.
// Synthetic SQL rows are NOT a substitute for CreateIndependentPickupOrder's
// approved-publication, phone-proof, full order/quote or HTTP flow.
func exerciseIndependentDirectOrderConcurrentDraftAndIdempotencySQL(
	t *testing.T, ctx context.Context, db *sql.DB,
	independentStoreID, marketplaceStoreID, offerID, productID, variantID string,
) {
	t.Helper()
	t.Run("concurrent unreviewed checkout rejects both attempts without persistence", func(t *testing.T) {
		attempt := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("R", 32)))
		req := postgres.IndependentDirectOrderRequest{
			StoreID: independentStoreID, IdempotencyKey: attempt,
			GuestName: "Concurrent Draft Buyer", GuestPhoneE164: "+967700001123",
			ExpectedMerchantPolicyVersion: "v3", ExpectedSubtotalMinor: 600,
			FulfillmentMode: "CUSTOMER_PICKUP",
			Lines: []postgres.IndependentDirectOrderLineRequest{{
				OfferID: offerID, QuantityBaseUnits: 1,
			}},
		}
		secret := []byte(strings.Repeat("D", 32))
		results := make([]error, 2)
		start := make(chan struct{})
		var both sync.WaitGroup
		for i := range results {
			both.Add(1)
			go func(i int) {
				defer both.Done()
				<-start
				_, results[i] = postgres.CreateIndependentPickupOrder(
					ctx, db, secret, "qa-not-legally-approved", req)
			}(i)
		}
		close(start)
		both.Wait()
		for i, err := range results {
			if !errors.Is(err, postgres.ErrIndependentOrderUnavailable) {
				t.Fatalf("draft concurrent checkout %d must fail closed, got %v", i, err)
			}
		}
		wrongStore := req
		wrongStore.StoreID = marketplaceStoreID
		if _, err := postgres.CreateIndependentPickupOrder(
			ctx, db, secret, "qa-not-legally-approved", wrongStore); !errors.Is(err, postgres.ErrIndependentOrderUnavailable) {
			t.Fatalf("marketplace Store checkout with same key must fail closed: %v", err)
		}
		attemptDigest := sha256.Sum256([]byte("dsh:independent-direct-order:v1:" + attempt))
		keyHash := hex.EncodeToString(attemptDigest[:])
		var keyCount, orderCount int
		if err := db.QueryRowContext(ctx,
			`SELECT count(*) FROM dsh.independent_direct_order_idempotency WHERE key_hash=$1`, keyHash).
			Scan(&keyCount); err != nil || keyCount != 0 {
			t.Fatalf("failed draft attempts must not persist an idempotency key: count=%d err=%v", keyCount, err)
		}
		if err := db.QueryRowContext(ctx,
			`SELECT count(*) FROM dsh.independent_direct_orders WHERE guest_name=$1`, req.GuestName).
			Scan(&orderCount); err != nil || orderCount != 0 {
			t.Fatalf("failed draft attempts must not persist an Order: count=%d err=%v", orderCount, err)
		}
	})

	t.Run("concurrent synthetic SQL transactions preserve one global key and atomic order lines", func(t *testing.T) {
		// A draft is deliberately NOT promoted to PASSED/PUBLISHED here.
		// This exercises unique-key, FK and rollback mechanics only, not
		// a lawful application-level checkout.
		raceCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		idemDigest := sha256.Sum256([]byte("qa:independent:direct:sql-key-race"))
		requestDigest := sha256.Sum256([]byte("qa:independent:direct:identical-synthetic-request"))
		keyHash := hex.EncodeToString(idemDigest[:])
		requestHash := hex.EncodeToString(requestDigest[:])
		const insertOrder = `INSERT INTO dsh.independent_direct_orders
			(id,store_id,publication_version,store_version,fulfillment_mode,
			 guest_name,guest_phone_e164,hosting_terms_version,merchant_policy_version,
			 merchant_policy_snapshot,subtotal_amount_minor,merchant_delivery_fee_minor,
			 total_amount_minor,guest_capability_hash,guest_capability_expires_at)
			VALUES($1,$2,1,1,'CUSTOMER_PICKUP','Synthetic Race Buyer','+967700001124',
			       'qa-unreleased-terms','qa-unreviewed-policy',
			       '{"cancellationTerms":"qa only","returnsTerms":"qa only","fulfillmentTerms":"qa only","collectionTerms":"qa only"}'::jsonb,
			       600,0,600,$3,clock_timestamp()+interval '10 minutes')`
		const insertLine = `INSERT INTO dsh.independent_direct_order_lines
			(order_id,store_id,offer_id,product_id,variant_id,product_name,variant_title,
			 quantity_base_units,pricing_unit_base_units,unit_price_minor,line_amount_minor)
			VALUES($1,$2,$3,$4,$5,'Synthetic Offer','Unit',1,1,600,600)`
		const insertAttempt = `INSERT INTO dsh.independent_direct_order_idempotency
			(key_hash,request_hash,store_id,order_id) VALUES($1,$2,$3,$4)`
		type raceResult struct {
			id        string
			committed bool
			err       error
		}
		results := []raceResult{
			{id: "qa-direct-race-candidate-1"},
			{id: "qa-direct-race-candidate-2"},
		}
		start := make(chan struct{})
		var both sync.WaitGroup
		for i := range results {
			both.Add(1)
			go func(i int) {
				defer both.Done()
				<-start
				tx, err := db.BeginTx(raceCtx, nil)
				if err != nil {
					results[i].err = err
					return
				}
				defer func() { _ = tx.Rollback() }()
				capability := strings.Repeat(string(rune('1'+i)), 64)
				if _, err = tx.ExecContext(raceCtx, insertOrder,
					results[i].id, independentStoreID, capability); err != nil {
					results[i].err = err
					return
				}
				if _, err = tx.ExecContext(raceCtx, insertLine,
					results[i].id, independentStoreID, offerID, productID, variantID); err != nil {
					results[i].err = err
					return
				}
				if _, err = tx.ExecContext(raceCtx, insertAttempt,
					keyHash, requestHash, independentStoreID, results[i].id); err != nil {
					results[i].err = err
					return
				}
				results[i].err = tx.Commit()
				results[i].committed = results[i].err == nil
			}(i)
		}
		close(start)
		both.Wait()
		var winner string
		successes, conflicts := 0, 0
		for i, result := range results {
			if result.committed {
				successes++
				winner = result.id
				continue
			}
			var pqErr *pq.Error
			if !errors.As(result.err, &pqErr) || string(pqErr.Code) != "23505" ||
				pqErr.Constraint != "independent_direct_order_idempotency_pkey" {
				t.Fatalf("race lane %d failed for a reason other than global attempt-key uniqueness: %v", i, result.err)
			}
			conflicts++
		}
		if successes != 1 || conflicts != 1 {
			t.Fatalf("SQL idempotency race must commit one atomic transaction and reject one: %+v", results)
		}
		var winnerOrder, winnerStore, winnerHash string
		if err := db.QueryRowContext(ctx, `SELECT order_id,store_id,request_hash
			FROM dsh.independent_direct_order_idempotency WHERE key_hash=$1`, keyHash).
			Scan(&winnerOrder, &winnerStore, &winnerHash); err != nil ||
			winnerOrder != winner || winnerStore != independentStoreID || winnerHash != requestHash {
			t.Fatalf("global attempt readback must identify exactly the winner: order=%s store=%s hash=%s err=%v",
				winnerOrder, winnerStore, winnerHash, err)
		}
		var orders, lines int
		var amount int64
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.independent_direct_orders
			WHERE id IN ($1,$2)`, results[0].id, results[1].id).Scan(&orders); err != nil || orders != 1 {
			t.Fatalf("losing race must roll back its Order: count=%d err=%v", orders, err)
		}
		if err := db.QueryRowContext(ctx, `SELECT count(*),COALESCE(sum(line_amount_minor),0)
			FROM dsh.independent_direct_order_lines WHERE order_id IN ($1,$2)`,
			results[0].id, results[1].id).Scan(&lines, &amount); err != nil || lines != 1 || amount != 600 {
			t.Fatalf("losing race must roll back its line with the Order: count=%d amount=%d err=%v", lines, amount, err)
		}
		var keys int
		if err := db.QueryRowContext(ctx,
			`SELECT count(*) FROM dsh.independent_direct_order_idempotency WHERE key_hash=$1`,
			keyHash).Scan(&keys); err != nil || keys != 1 {
			t.Fatalf("two concurrent SQL transactions cannot duplicate the attempt key: count=%d err=%v", keys, err)
		}
	})
}
