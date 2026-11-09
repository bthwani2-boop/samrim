package postgres

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lib/pq"
)

var (
	ErrIndependentOrderInvalid     = errors.New("independent order input is invalid")
	ErrIndependentOrderUnavailable = errors.New("independent order is not available")
	ErrIndependentOrderConflict    = errors.New("independent order idempotency conflicts with another request")
	ErrIndependentOrderQuote       = errors.New("independent order cannot be priced safely")
)

// IndependentDirectOrderLineRequest contains no untrusted price or amount.
type IndependentDirectOrderLineRequest struct {
	OfferID           string `json:"offerId"`
	QuantityBaseUnits int64  `json:"quantityBaseUnits"`
}

// IndependentDirectOrderRequest is a bounded, internal DSH writer input.
// Caller-provided roles, owners, payment methods, authoritative prices and
// inventory reserves are deliberately absent. Customer-visible expectations
// only reject stale confirmations; they never determine a charged amount.
// This writer is NOT registered as public HTTP.
type IndependentDirectOrderRequest struct {
	StoreID        string `json:"storeId"`
	IdempotencyKey string `json:"idempotencyKey"`
	GuestName      string `json:"guestName"`
	GuestPhoneE164 string `json:"guestPhoneE164"`
	// Customer-visible observations, never authoritative prices or legal policy.
	// DSH rejects an order if the server-side policy/quote changed after display.
	ExpectedMerchantPolicyVersion string                              `json:"expectedMerchantPolicyVersion"`
	ExpectedSubtotalMinor         int64                               `json:"expectedSubtotalMinor"`
	FulfillmentMode               string                              `json:"fulfillmentMode"`
	Lines                         []IndependentDirectOrderLineRequest `json:"lines"`
}

type IndependentDirectOrderReceipt struct {
	OrderID         string    `json:"orderId"`
	StoreID         string    `json:"storeId"`
	State           string    `json:"state"`
	TotalMinor      int64     `json:"totalMinor"`
	Currency        string    `json:"currency"`
	StatusToken     string    `json:"statusToken"`
	StatusExpiresAt time.Time `json:"statusExpiresAt"`
	Replayed        bool      `json:"replayed"`
}

type IndependentDirectOrderStatus struct {
	OrderID string `json:"orderId"`
	StoreID string `json:"storeId"`
	State   string `json:"state"`
	Version int    `json:"version"`
	// Never include name, phone, address, offer metadata or financial details.
}

func normalizedIndependentOrder(input IndependentDirectOrderRequest) (IndependentDirectOrderRequest, string, string, error) {
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.GuestName = strings.TrimSpace(input.GuestName)
	input.GuestPhoneE164 = strings.TrimSpace(input.GuestPhoneE164)
	input.ExpectedMerchantPolicyVersion = strings.TrimSpace(input.ExpectedMerchantPolicyVersion)
	input.FulfillmentMode = strings.TrimSpace(input.FulfillmentMode)
	if input.StoreID == "" || len(input.StoreID) > 128 ||
		!utf8.ValidString(input.StoreID) || strings.ContainsAny(input.StoreID, "\x00\r\n") ||
		len(input.IdempotencyKey) != 43 ||
		!utf8.ValidString(input.GuestName) || strings.ContainsAny(input.GuestName, "\x00\r\n") ||
		utf8.RuneCountInString(input.GuestName) < 2 || utf8.RuneCountInString(input.GuestName) > 120 ||
		!storePublicPhonePattern.MatchString(input.GuestPhoneE164) ||
		input.ExpectedMerchantPolicyVersion == "" || len(input.ExpectedMerchantPolicyVersion) > 128 ||
		!utf8.ValidString(input.ExpectedMerchantPolicyVersion) ||
		strings.ContainsAny(input.ExpectedMerchantPolicyVersion, "\r\n\x00") ||
		input.ExpectedSubtotalMinor <= 0 ||
		(input.FulfillmentMode != "CUSTOMER_PICKUP" && input.FulfillmentMode != "PARTNER_CAPTAIN") ||
		len(input.Lines) == 0 || len(input.Lines) > 20 {
		return IndependentDirectOrderRequest{}, "", "", ErrIndependentOrderInvalid
	}
	// An attempt key is an opaque 32-byte random value encoded as canonical
	// unpadded base64url. Its entropy must be generated/checked by the future
	// transport owner; never accept a short or human-chosen token at DSH.
	attemptKey, keyErr := base64.RawURLEncoding.DecodeString(input.IdempotencyKey)
	if keyErr != nil || len(attemptKey) != 32 || base64.RawURLEncoding.EncodeToString(attemptKey) != input.IdempotencyKey {
		return IndependentDirectOrderRequest{}, "", "", ErrIndependentOrderInvalid
	}
	// Use the exact same Store/Offer/quantity validation as the read-only
	// quote. Its copied slice keeps canonical sorting from mutating the cart.
	var linesErr error
	input.Lines, linesErr = normalizeIndependentPickupQuoteLines(input.Lines)
	if linesErr != nil {
		return IndependentDirectOrderRequest{}, "", "", linesErr
	}
	sort.Slice(input.Lines, func(i, j int) bool { return input.Lines[i].OfferID < input.Lines[j].OfferID })
	// The key is globally unique for an attempt. Reusing it with another Store
	// or another request body is rejected, even with a different caller.
	keyDigest := sha256.Sum256([]byte("dsh:independent-direct-order:v1:" + input.IdempotencyKey))
	facts, err := json.Marshal(input)
	if err != nil {
		return IndependentDirectOrderRequest{}, "", "", err
	}
	factsDigest := sha256.Sum256(facts)
	return input, hex.EncodeToString(keyDigest[:]), hex.EncodeToString(factsDigest[:]), nil
}

func independentGuestCapability(secret []byte, keyHash string) (string, string, error) {
	if len(secret) < 32 || keyHash == "" {
		return "", "", ErrIndependentOrderInvalid
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("dsh:independent-direct-order:status:v1:" + keyHash))
	token := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	digest := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(digest[:]), nil
}

// replayableIndependentGuestStatusToken preserves the original bearer only
// while it remains the stored, unexpired capability. Rotating a secret may
// preserve the immutable order receipt but must never mint a new bearer.
func replayableIndependentGuestStatusToken(token, currentHash, persistedHash string, expires, now time.Time) string {
	if !expires.After(now) || subtle.ConstantTimeCompare([]byte(persistedHash), []byte(currentHash)) != 1 {
		return ""
	}
	return token
}

// independentDirectUnitOfferSupported matches the published independent
// Catalog's intentionally narrow direct-order subset. A different pricing
// unit must never become orderable merely by bypassing the public listing.
func independentDirectUnitOfferSupported(pricingBasis, inventoryPolicy string, pricingUnit sql.NullInt64) bool {
	return pricingBasis == "PER_UNIT" && inventoryPolicy == "AVAILABILITY_ONLY" &&
		pricingUnit.Valid && pricingUnit.Int64 == 1
}

func independentLineAmount(priceMinor, quantityBaseUnits, pricingUnitBaseUnits int64) (int64, error) {
	if priceMinor <= 0 || quantityBaseUnits <= 0 || pricingUnitBaseUnits <= 0 ||
		quantityBaseUnits%pricingUnitBaseUnits != 0 {
		return 0, ErrIndependentOrderQuote
	}
	count := quantityBaseUnits / pricingUnitBaseUnits
	if count > math.MaxInt64/priceMinor {
		return 0, ErrIndependentOrderQuote
	}
	return count * priceMinor, nil
}

// verifyIndependentCustomerConfirmation never treats client-visible price or
// policy version as a source of truth. It only refuses checkout when either
// observation differs from the locked, reviewed DSH facts.
func verifyIndependentCustomerConfirmation(input IndependentDirectOrderRequest, reviewedPolicyVersion string, serverSubtotalMinor int64) error {
	if reviewedPolicyVersion == "" || input.ExpectedMerchantPolicyVersion != reviewedPolicyVersion ||
		serverSubtotalMinor <= 0 || input.ExpectedSubtotalMinor != serverSubtotalMinor {
		return ErrIndependentOrderQuote
	}
	return nil
}

type independentOrderLine struct {
	offerID, productID, variantID, productName, variantTitle string
	quantity, pricingUnit, unitPrice, lineTotal              int64
}

// The public independent Catalog and the Direct Order writer must enforce the
// same buyable subset. A known but unlisted Offer ID must not bypass Catalog
// pricing/quantity/rights guards through this internal writer.
const independentDirectOrderOfferBaseQuery = `SELECT o.id,v.id,p.id,p.canonical_name,v.title,o.price_minor,
	o.quantity_min_base_units,o.quantity_max_base_units,o.quantity_step_base_units,
	o.pricing_unit_base_units,o.pricing_basis,o.inventory_policy
	FROM dsh.catalog_store_offers o
	JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
	JOIN dsh.catalog_products p ON p.id=v.product_id
	JOIN dsh.stores s ON s.id=o.store_id
	WHERE o.id=$1 AND o.store_id=$2` + independentDirectBuyableOfferSQL

const independentDirectOrderOfferQuery = independentDirectOrderOfferBaseQuery + ` FOR SHARE OF o,v,p`

// CreateIndependentPickupOrder is a transactionally idempotent, server-priced,
// pickup-only DSH owner primitive. Merchant delivery stays disabled until DSH
// owns a verified address/serviceability/fee policy. This method must NOT be
// made publicly callable before lawful terms, rate limits and review gates.
func CreateIndependentPickupOrder(ctx context.Context, db *sql.DB, secret []byte, approvedLegalTermsVersion string, raw IndependentDirectOrderRequest) (IndependentDirectOrderReceipt, error) {
	input, keyHash, requestHash, err := normalizedIndependentOrder(raw)
	if err != nil {
		return IndependentDirectOrderReceipt{}, err
	}
	approvedLegalTermsVersion = strings.TrimSpace(approvedLegalTermsVersion)
	// Only a server-issued, legally admitted terms version is allowed here.
	// Guest input cannot select or self-approve a legal version.
	if db == nil || len(secret) < 32 || approvedLegalTermsVersion == "" || input.FulfillmentMode != "CUSTOMER_PICKUP" {
		return IndependentDirectOrderReceipt{}, ErrIndependentOrderQuote
	}
	statusToken, statusHash, err := independentGuestCapability(secret, keyHash)
	if err != nil {
		return IndependentDirectOrderReceipt{}, err
	}
	// Replay lookup precedes current publication readiness: a legitimately
	// recorded Order remains the same Order after the Store is suspended.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return IndependentDirectOrderReceipt{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:independent-direct-order:key:"+keyHash); err != nil {
		return IndependentDirectOrderReceipt{}, fmt.Errorf("lock independent order attempt: %w", err)
	}
	var existingOrder, existingStore, existingHash string
	err = tx.QueryRowContext(ctx, `SELECT order_id,store_id,request_hash FROM dsh.independent_direct_order_idempotency WHERE key_hash=$1 FOR UPDATE`, keyHash).
		Scan(&existingOrder, &existingStore, &existingHash)
	if err == nil {
		if existingStore != input.StoreID || existingHash != requestHash {
			return IndependentDirectOrderReceipt{}, ErrIndependentOrderConflict
		}
		receipt := IndependentDirectOrderReceipt{OrderID: existingOrder, StoreID: input.StoreID, Currency: "YER", Replayed: true}
		var expires time.Time
		var persistedCapabilityHash string
		// The idempotency record and request hash, not the current HMAC key,
		// identify the historical Order. A rotated secret must not make a
		// committed Order appear missing or change its original receipt.
		err = tx.QueryRowContext(ctx, `SELECT state,total_amount_minor,guest_capability_expires_at,guest_capability_hash
			FROM dsh.independent_direct_orders WHERE id=$1 AND store_id=$2`, existingOrder, input.StoreID).
			Scan(&receipt.State, &receipt.TotalMinor, &expires, &persistedCapabilityHash)
		if err != nil {
			return IndependentDirectOrderReceipt{}, fmt.Errorf("read independent order replay: %w", err)
		}
		receipt.StatusExpiresAt = expires
		// Reissue the original status bearer only if the existing hash still
		// matches the server's current signing secret and has not expired.
		// Never replace the stored hash or extend the original expiry on
		// replay. Rotated/expired credentials need separately admitted
		// verified-phone recovery before a public endpoint can be enabled.
		receipt.StatusToken = replayableIndependentGuestStatusToken(
			statusToken, statusHash, persistedCapabilityHash, expires, time.Now().UTC())
		if err := tx.Commit(); err != nil {
			return IndependentDirectOrderReceipt{}, err
		}
		return receipt, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return IndependentDirectOrderReceipt{}, fmt.Errorf("read independent order attempt: %w", err)
	}
	var storeVersion, publicationVersion int
	var hostingTermsVersion, merchantPolicyVersion string
	var cancellationTerms, returnsTerms, fulfillmentTerms, collectionTerms string
	var modes []string
	// Store row lock serializes an independent order against relation cutover.
	err = tx.QueryRowContext(ctx, `SELECT s.version,p.version,p.terms_version,s.fulfillment_modes,
		       cp.policy_version,cp.cancellation_terms,cp.returns_terms,cp.fulfillment_terms,cp.collection_terms
		FROM dsh.stores s
		JOIN dsh.service_cities city ON city.id=s.service_city_id AND city.active=true
		JOIN dsh.independent_store_publications p ON p.store_id=s.id
		JOIN dsh.independent_store_customer_policies cp ON cp.store_id=s.id
		JOIN dsh.store_public_contacts c ON c.store_id=s.id
		WHERE s.id=$1 AND s.relation_model='INDEPENDENT_STORE' AND s.deleted_at IS NULL
		  AND s.publication_state<>'published' AND p.state='PUBLISHED_INDEPENDENT'
		  AND p.review_state='PASSED' AND p.terms_accepted_at IS NOT NULL
		  AND p.terms_accepted_by_actor_id=s.partner_actor_id
		  AND p.published_at IS NOT NULL AND p.terms_version=$2
		  AND cp.review_state='PASSED' AND cp.published_at IS NOT NULL
		  AND cp.authored_by_actor_id=s.partner_actor_id
		  AND NULLIF(btrim(cp.reviewed_by_actor_id),'') IS NOT NULL
		  AND (c.phone_e164<>'' OR c.email<>'' OR c.whatsapp_enabled)
		  AND EXISTS (SELECT 1 FROM dsh.store_profile_media_assets a
		      WHERE a.store_id=s.id AND a.media_role='primary' AND a.state='active' AND a.rights_attested_at IS NOT NULL AND NULLIF(btrim(a.uri),'') IS NOT NULL)
		  AND EXISTS (SELECT 1 FROM dsh.store_profile_media_assets a
		      WHERE a.store_id=s.id AND a.media_role='cover' AND a.state='active' AND a.rights_attested_at IS NOT NULL AND NULLIF(btrim(a.uri),'') IS NOT NULL)
		FOR SHARE OF s,p,cp`, input.StoreID, approvedLegalTermsVersion).
		Scan(&storeVersion, &publicationVersion, &hostingTermsVersion, pq.Array(&modes),
			&merchantPolicyVersion, &cancellationTerms, &returnsTerms, &fulfillmentTerms, &collectionTerms)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentDirectOrderReceipt{}, ErrIndependentOrderUnavailable
	}
	if err != nil {
		return IndependentDirectOrderReceipt{}, fmt.Errorf("lock independent Store checkout: %w", err)
	}
	if !containsString(modes, "CUSTOMER_PICKUP") || hostingTermsVersion == "" ||
		merchantPolicyVersion == "" || cancellationTerms == "" || returnsTerms == "" ||
		fulfillmentTerms == "" || collectionTerms == "" {
		return IndependentDirectOrderReceipt{}, ErrIndependentOrderUnavailable
	}
	// Snapshot the Store's reviewed customer-facing terms. Hosting consent is
	// a distinct legal fact; never put it in a merchant policy field.
	merchantPolicySnapshot, err := json.Marshal(struct {
		CancellationTerms string `json:"cancellationTerms"`
		ReturnsTerms      string `json:"returnsTerms"`
		FulfillmentTerms  string `json:"fulfillmentTerms"`
		CollectionTerms   string `json:"collectionTerms"`
	}{cancellationTerms, returnsTerms, fulfillmentTerms, collectionTerms})
	if err != nil {
		return IndependentDirectOrderReceipt{}, err
	}
	// A row lazily initialized before independent scheduling was closed by
	// default is not evidence of the merchant's chosen pickup hours.
	var availabilityConfigured bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.store_operational_availability
		WHERE store_id=$1 AND NOT (schedule_mode='ALWAYS_OPEN' AND version=1
			AND updated_by_actor_id IN ('system:lazy-initialize','system:checkout-initialize')))`, input.StoreID).Scan(&availabilityConfigured); err != nil {
		return IndependentDirectOrderReceipt{}, err
	}
	if !availabilityConfigured {
		return IndependentDirectOrderReceipt{}, ErrIndependentOrderUnavailable
	}
	orderability, err := lockAndEvaluateStoreOrderability(ctx, tx, input.StoreID, "CUSTOMER_PICKUP")
	if err != nil {
		return IndependentDirectOrderReceipt{}, err
	}
	if orderability.State != StoreOrderabilityOpenForOrders {
		return IndependentDirectOrderReceipt{}, ErrIndependentOrderUnavailable
	}
	snapshots := make([]independentOrderLine, 0, len(input.Lines))
	var subtotal int64
	for _, line := range input.Lines {
		var item independentOrderLine
		var minQty, maxQty, stepQty, priceUnit sql.NullInt64
		var pricingBasis, inventoryPolicy string
		err := tx.QueryRowContext(ctx, independentDirectOrderOfferQuery, line.OfferID, input.StoreID).
			Scan(&item.offerID, &item.variantID, &item.productID, &item.productName, &item.variantTitle,
				&item.unitPrice, &minQty, &maxQty, &stepQty, &priceUnit, &pricingBasis, &inventoryPolicy)
		if errors.Is(err, sql.ErrNoRows) {
			return IndependentDirectOrderReceipt{}, ErrIndependentOrderUnavailable
		}
		if err != nil {
			return IndependentDirectOrderReceipt{}, fmt.Errorf("read independent Store offer: %w", err)
		}
		// No modifier/special pricing or stock reservation is silently dropped.
		if !independentDirectUnitOfferSupported(pricingBasis, inventoryPolicy, priceUnit) ||
			!minQty.Valid || !maxQty.Valid || !stepQty.Valid ||
			minQty.Int64 <= 0 || stepQty.Int64 <= 0 || maxQty.Int64 < minQty.Int64 ||
			line.QuantityBaseUnits < minQty.Int64 || line.QuantityBaseUnits > maxQty.Int64 ||
			(line.QuantityBaseUnits-minQty.Int64)%stepQty.Int64 != 0 {
			return IndependentDirectOrderReceipt{}, ErrIndependentOrderQuote
		}
		item.quantity = line.QuantityBaseUnits
		item.pricingUnit = priceUnit.Int64
		item.lineTotal, err = independentLineAmount(item.unitPrice, item.quantity, item.pricingUnit)
		if err != nil || item.lineTotal > math.MaxInt64-subtotal {
			return IndependentDirectOrderReceipt{}, ErrIndependentOrderQuote
		}
		subtotal += item.lineTotal
		snapshots = append(snapshots, item)
	}
	// The expected price and displayed policy version are stale-view guards,
	// NOT authority for pricing or legal approval. Compare both under the same
	// transaction after reading reviewed policy and pricing canonical Offers.
	if err := verifyIndependentCustomerConfirmation(input, merchantPolicyVersion, subtotal); err != nil {
		return IndependentDirectOrderReceipt{}, err
	}
	orderID, err := newID("independent-order")
	if err != nil {
		return IndependentDirectOrderReceipt{}, err
	}
	const statusLifetime = 15 * time.Minute
	expires := time.Now().UTC().Add(statusLifetime)
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_direct_orders(
		id,store_id,publication_version,store_version,state,fulfillment_mode,payment_method,
		guest_name,guest_phone_e164,delivery_address,hosting_terms_version,
		merchant_policy_version,merchant_policy_snapshot,
		subtotal_amount_minor,merchant_delivery_fee_minor,total_amount_minor,currency,
		guest_capability_hash,guest_capability_expires_at)
		VALUES($1,$2,$3,$4,'SUBMITTED','CUSTOMER_PICKUP','MERCHANT_DIRECT_AT_FULFILLMENT',
		$5,$6,NULL,$7,$8,$9,$10,0,$10,'YER',$11,$12)`,
		orderID, input.StoreID, publicationVersion, storeVersion, input.GuestName,
		input.GuestPhoneE164, hostingTermsVersion, merchantPolicyVersion,
		string(merchantPolicySnapshot), subtotal, statusHash, expires)
	if err != nil {
		return IndependentDirectOrderReceipt{}, fmt.Errorf("insert independent order: %w", err)
	}
	for _, item := range snapshots {
		_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_direct_order_lines(
			order_id,store_id,offer_id,product_id,variant_id,product_name,variant_title,
			quantity_base_units,pricing_unit_base_units,unit_price_minor,line_amount_minor)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			orderID, input.StoreID, item.offerID, item.productID, item.variantID, item.productName,
			item.variantTitle, item.quantity, item.pricingUnit, item.unitPrice, item.lineTotal)
		if err != nil {
			return IndependentDirectOrderReceipt{}, fmt.Errorf("insert independent order line: %w", err)
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_direct_order_idempotency(key_hash,request_hash,store_id,order_id)
		VALUES($1,$2,$3,$4)`, keyHash, requestHash, input.StoreID, orderID)
	if err != nil {
		return IndependentDirectOrderReceipt{}, fmt.Errorf("record independent order attempt: %w", err)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.independent_direct_order_audit
		(order_id,actor_id,event_type,to_state,result_version)
		VALUES($1,'guest:direct','created','SUBMITTED',1)`, orderID)
	if err != nil {
		return IndependentDirectOrderReceipt{}, fmt.Errorf("audit independent order creation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return IndependentDirectOrderReceipt{}, fmt.Errorf("commit independent order: %w", err)
	}
	return IndependentDirectOrderReceipt{OrderID: orderID, StoreID: input.StoreID,
		State: "SUBMITTED", TotalMinor: subtotal, Currency: "YER",
		StatusToken: statusToken, StatusExpiresAt: expires}, nil
}

// A guest status bearer is a canonical, unpadded base64url encoding of exactly
// one 32-byte HMAC-SHA256 digest. Reject malformed tokens and oversized IDs
// without querying storage, even if a future public caller misses validation.
func independentGuestStatusLookupValid(storeID, orderID, statusToken string) bool {
	if storeID == "" || orderID == "" ||
		len(storeID) > 128 || len(orderID) > 128 ||
		!utf8.ValidString(storeID) || !utf8.ValidString(orderID) ||
		storeID != strings.TrimSpace(storeID) || orderID != strings.TrimSpace(orderID) ||
		strings.ContainsAny(storeID, "\x00\r\n") || strings.ContainsAny(orderID, "\x00\r\n") ||
		len(statusToken) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(statusToken)
	return err == nil && len(decoded) == sha256.Size &&
		base64.RawURLEncoding.EncodeToString(decoded) == statusToken
}

// ReadIndependentDirectOrderStatus reveals only a non-PII status. The caller
// must enforce a per-IP/Store/attempt rate limiter before exposing it on HTTP.
func ReadIndependentDirectOrderStatus(ctx context.Context, db *sql.DB, storeID, orderID, statusToken string) (IndependentDirectOrderStatus, error) {
	if db == nil || !independentGuestStatusLookupValid(storeID, orderID, statusToken) {
		return IndependentDirectOrderStatus{}, ErrIndependentOrderUnavailable
	}
	digest := sha256.Sum256([]byte(statusToken))
	var status IndependentDirectOrderStatus
	err := db.QueryRowContext(ctx, `SELECT id,store_id,state,version
		FROM dsh.independent_direct_orders WHERE id=$1 AND store_id=$2
		AND guest_capability_hash=$3 AND guest_capability_expires_at>clock_timestamp()`,
		orderID, storeID, hex.EncodeToString(digest[:])).
		Scan(&status.OrderID, &status.StoreID, &status.State, &status.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentDirectOrderStatus{}, ErrIndependentOrderUnavailable
	}
	if err != nil {
		return IndependentDirectOrderStatus{}, err
	}
	return status, nil
}

// Server-only helpers avoid creating any second payment, dispatch or account
// ownership fact. The token key must be injected from secret configuration.
func containsString(values []string, match string) bool {
	for _, value := range values {
		if value == match {
			return true
		}
	}
	return false
}
