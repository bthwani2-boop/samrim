package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	phoneformat "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/phone"
	"github.com/lib/pq"
)

func paymentCompensationFailure(returnErr, compensationErr error) error {
	if returnErr == nil {
		returnErr = fmt.Errorf("%w: payment compensation failed: %w", ErrPaymentProvisioning, compensationErr)
	} else {
		returnErr = fmt.Errorf("%w: payment compensation failed: %w", returnErr, compensationErr)
	}
	return fmt.Errorf("%w: %w", ErrExternalOutcomeUnknown, returnErr)
}

func reconcileCheckoutPayment(ctx context.Context, clientActorID, cartID, idempotencyKey, externalReference, paymentCancellationKey, correlationID string, reader PaymentIntentRecoveryReader, canceller PaymentIntentCanceller) error {
	payment, found, err := reader(ctx, externalReference)
	if err != nil {
		return fmt.Errorf("%w: payment intent recovery read failed: %w", ErrExternalOutcomeUnknown, err)
	}
	if !found {
		return nil
	}
	expectedOrderID := stableCheckoutOrderID(clientActorID, cartID, idempotencyKey)
	if strings.TrimSpace(payment.IntentID) == "" || payment.ExternalReference != externalReference || payment.PayerActorID != clientActorID || payment.OrderID != expectedOrderID || (payment.Method != "CASH_ON_DELIVERY" && payment.Method != "CASH_AT_STORE") {
		return fmt.Errorf("%w: recovered payment does not match the client checkout", ErrExternalOutcomeUnknown)
	}
	switch payment.State {
	case "CANCELLED":
		return ErrCheckoutPaymentReconciled
	case "REQUIRES_COLLECTION":
		if err := canceller(ctx, payment.IntentID, "order_creation_rolled_back", paymentCancellationKey, correlationID); err != nil {
			return fmt.Errorf("%w: payment intent recovery cancellation failed: %w", ErrExternalOutcomeUnknown, err)
		}
		return ErrCheckoutPaymentReconciled
	default:
		return fmt.Errorf("%w: recovered payment state %q is not safely cancellable", ErrExternalOutcomeUnknown, payment.State)
	}
}

func readCheckoutOrderReplay(ctx context.Context, tx *sql.Tx, clientActorID, cartID, idempotencyKey, requestHash string) (OrderRecord, bool, error) {
	var storedHash, storedCartID, orderID string
	err := tx.QueryRowContext(ctx, "SELECT request_hash,cart_id,order_id FROM dsh.commerce_order_checkout_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedCartID, &orderID)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, nil
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if (requestHash != "" && storedHash != requestHash) || storedCartID != cartID {
		return OrderRecord{}, false, ErrCheckoutIdempotencyConflict
	}
	order, err := readOrder(ctx, tx, "o.id=$1", orderID)
	if err != nil {
		return OrderRecord{}, false, err
	}
	if order.ClientActorID != clientActorID {
		return OrderRecord{}, false, ErrCheckoutIdempotencyConflict
	}
	return order, true, nil
}

func checkoutOrderMatchesRequest(order OrderRecord, input CheckoutInput) bool {
	return order.ClientActorID == strings.TrimSpace(input.ClientActorID) &&
		order.CartID == strings.TrimSpace(input.CartID) &&
		order.StoreID == strings.TrimSpace(input.StoreID) &&
		order.AddressID == strings.TrimSpace(input.AddressID) &&
		order.FulfillmentMode == strings.TrimSpace(input.FulfillmentMode) &&
		deliveryRecipientRecordMatchesInput(order.Recipient, input.Recipient) &&
		order.PaymentMethod == strings.TrimSpace(input.PaymentMethod) &&
		order.TotalAmountMinor-order.PaymentCashAmountMinor == input.InternalBalanceAmountMinor &&
		order.PromotionCode == strings.ToUpper(strings.TrimSpace(input.PromotionCode))
}

func deliveryRecipientRecordMatchesInput(record DeliveryRecipientRecord, input DeliveryRecipientInput) bool {
	recordMode := strings.ToUpper(strings.TrimSpace(record.Mode))
	inputMode := strings.ToUpper(strings.TrimSpace(input.Mode))
	if recordMode == "" {
		recordMode = "SELF"
	}
	if inputMode == "" {
		inputMode = "SELF"
	}
	if recordMode != inputMode {
		return false
	}
	if recordMode == "SELF" {
		return true
	}
	return recipientRecordValue(record.Name) == strings.TrimSpace(input.Name) &&
		recipientRecordValue(record.PhoneE164) == phoneformat.NormalizeYemenE164(input.PhoneE164) &&
		recipientRecordValue(record.Instructions) == strings.TrimSpace(input.Instructions)
}

func recipientRecordValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func checkoutReplayMatchesConfirmedTotal(order OrderRecord, expected *int64) bool {
	return expected == nil || (*expected > 0 && order.TotalAmountMinor == *expected)
}

func checkoutCartVersionMatches(state string, cartVersion, expectedCartVersion int) bool {
	return expectedCartVersion > 0 && state == "checked_out" && cartVersion == expectedCartVersion+1
}

func validateCheckoutOrderReplay(ctx context.Context, tx *sql.Tx, order OrderRecord, input CheckoutInput) error {
	if !checkoutOrderMatchesRequest(order, input) || !checkoutReplayMatchesConfirmedTotal(order, input.ExpectedTotalAmountMinor) {
		return ErrCheckoutIdempotencyConflict
	}
	var cartState string
	var cartVersion int
	err := tx.QueryRowContext(ctx, "SELECT state,version FROM dsh.commerce_carts WHERE id=$1 AND client_actor_id=$2", order.CartID, order.ClientActorID).Scan(&cartState, &cartVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCheckoutIdempotencyConflict
	}
	if err != nil {
		return err
	}
	if !checkoutCartVersionMatches(cartState, cartVersion, input.ExpectedCartVersion) {
		return ErrCheckoutIdempotencyConflict
	}
	return nil
}

func ResolveCheckoutAttempt(ctx context.Context, db *sql.DB, input CheckoutInput) (OrderRecord, bool, error) {
	input.ClientActorID, input.CartID, input.StoreID = strings.TrimSpace(input.ClientActorID), strings.TrimSpace(input.CartID), strings.TrimSpace(input.StoreID)
	input.AddressID, input.FulfillmentMode = strings.TrimSpace(input.AddressID), strings.TrimSpace(input.FulfillmentMode)
	input.PaymentMethod, input.PromotionCode = strings.TrimSpace(input.PaymentMethod), strings.ToUpper(strings.TrimSpace(input.PromotionCode))
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	input.PaymentExternalReference, input.PaymentCancellationKey = strings.TrimSpace(input.PaymentExternalReference), strings.TrimSpace(input.PaymentCancellationKey)
	if db == nil || input.ClientActorID == "" || input.CartID == "" || input.StoreID == "" || input.FulfillmentMode == "" || input.PaymentMethod == "" || input.ExpectedCartVersion < 1 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || input.PaymentExternalReference == "" || input.PaymentCancellationKey == "" || input.CorrelationID == "" || input.PaymentIntentRecoveryReader == nil || input.PaymentCanceller == nil {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:checkout:"+input.IdempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	order, replayed, err := readCheckoutOrderReplay(ctx, tx, input.ClientActorID, input.CartID, input.IdempotencyKey, "")
	if err != nil {
		return OrderRecord{}, false, err
	}
	if replayed {
		if err := validateCheckoutOrderReplay(ctx, tx, order, input); err != nil {
			return OrderRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if err := reconcileCheckoutPayment(ctx, input.ClientActorID, input.CartID, input.IdempotencyKey, input.PaymentExternalReference, input.PaymentCancellationKey, input.CorrelationID, input.PaymentIntentRecoveryReader, input.PaymentCanceller); err != nil {
		return OrderRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	return OrderRecord{}, false, nil
}

func CreateOrderFromCart(ctx context.Context, db *sql.DB, input CheckoutInput) (result OrderRecord, replayed bool, returnErr error) {
	recipient, recipientErr := NormalizeDeliveryRecipient(input.Recipient, input.FulfillmentMode)
	if recipientErr != nil {
		return OrderRecord{}, false, recipientErr
	}
	input.Recipient = recipient
	pickup := input.FulfillmentMode == FulfillmentModeCustomerPickup
	partnerCaptain := input.FulfillmentMode == FulfillmentModePartnerCaptain
	validMode := input.FulfillmentMode == FulfillmentModeBthwaniCaptain || partnerCaptain || pickup
	validPaymentMethod := ((pickup || partnerCaptain) && input.PaymentMethod == "CASH_AT_STORE") || (input.FulfillmentMode == FulfillmentModeBthwaniCaptain && input.PaymentMethod == "CASH_ON_DELIVERY")
	validEvidence := input.Evidence.StoreVersion > 0 && strings.TrimSpace(input.Evidence.ServiceCityID) != ""
	if pickup {
		validEvidence = validEvidence && strings.TrimSpace(input.AddressID) == "" && input.Evidence.AddressVersion == 0 && strings.TrimSpace(input.Evidence.Status) == "" && strings.TrimSpace(input.Evidence.PolicyVersion) == ""
	} else {
		validEvidence = validEvidence && strings.TrimSpace(input.AddressID) != "" && input.Evidence.AddressVersion > 0 && input.Evidence.Status == "SERVICEABLE" && strings.TrimSpace(input.Evidence.PolicyVersion) != ""
	}
	if strings.TrimSpace(input.ClientActorID) == "" || strings.TrimSpace(input.CartID) == "" || strings.TrimSpace(input.StoreID) == "" || !validMode || !validPaymentMethod || !validEvidence || input.ExpectedCartVersion < 1 || strings.TrimSpace(input.IdempotencyKey) == "" || strings.TrimSpace(input.RequestHash) == "" || strings.TrimSpace(input.CorrelationID) == "" || strings.TrimSpace(input.PaymentExternalReference) == "" || strings.TrimSpace(input.PaymentIdempotencyKey) == "" || strings.TrimSpace(input.PaymentCancellationKey) == "" || input.PaymentProvisioner == nil || input.PaymentIntentRecoveryReader == nil || input.PaymentCanceller == nil || input.DeliveryProofKeyring == nil {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	var paymentIntentID string
	commitAttempted := false
	defer func() {
		_ = tx.Rollback()
		if paymentIntentID == "" || commitAttempted {
			return
		}
		compensationContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if compensationErr := input.PaymentCanceller(compensationContext, paymentIntentID, "order_creation_rolled_back", input.PaymentCancellationKey, input.CorrelationID); compensationErr != nil {
			returnErr = paymentCompensationFailure(returnErr, compensationErr)
		}
	}()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:checkout:"+input.IdempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	order, replayed, err := readCheckoutOrderReplay(ctx, tx, input.ClientActorID, input.CartID, input.IdempotencyKey, input.RequestHash)
	if err != nil {
		return OrderRecord{}, false, err
	}
	if replayed {
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if err := reconcileCheckoutPayment(ctx, input.ClientActorID, input.CartID, input.IdempotencyKey, input.PaymentExternalReference, input.PaymentCancellationKey, input.CorrelationID, input.PaymentIntentRecoveryReader, input.PaymentCanceller); err != nil {
		return OrderRecord{}, false, err
	}
	var cart CartRecord
	err = tx.QueryRowContext(ctx, "SELECT id,store_id,state,version,created_at,updated_at FROM dsh.commerce_carts WHERE id=$1 AND client_actor_id=$2 FOR UPDATE", input.CartID, input.ClientActorID).Scan(&cart.ID, &cart.StoreID, &cart.State, &cart.Version, &cart.CreatedAt, &cart.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrCartNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if cart.StoreID != input.StoreID || cart.State != "open" || cart.Version != input.ExpectedCartVersion {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	var storeCityID string
	var storeVersion int
	var storeFulfillmentModes []string
	var addressCityID, addressText sql.NullString
	var addressVersion sql.NullInt64
	var latitude, longitude sql.NullFloat64
	err = tx.QueryRowContext(ctx, `SELECT s.service_city_id,s.version,s.fulfillment_modes,a.service_city_id,a.version,a.address_text,a.latitude,a.longitude
FROM dsh.stores s JOIN dsh.service_cities c ON c.id=s.service_city_id AND c.active=true
LEFT JOIN dsh.delivery_addresses a ON a.id=NULLIF($2,'') AND a.client_actor_id=$3
WHERE s.id=$1 AND s.publication_state='published' AND ($4='CUSTOMER_PICKUP' OR a.id IS NOT NULL)`, input.StoreID, input.AddressID, input.ClientActorID, input.FulfillmentMode).Scan(&storeCityID, &storeVersion, pq.Array(&storeFulfillmentModes), &addressCityID, &addressVersion, &addressText, &latitude, &longitude)
	modeSupported := false
	for _, mode := range storeFulfillmentModes {
		if mode == input.FulfillmentMode {
			modeSupported = true
			break
		}
	}
	if errors.Is(err, sql.ErrNoRows) || storeCityID != input.Evidence.ServiceCityID || storeVersion != input.Evidence.StoreVersion || !modeSupported {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if !pickup && (!addressCityID.Valid || !addressVersion.Valid || !addressText.Valid || !latitude.Valid || !longitude.Valid || addressCityID.String != input.Evidence.ServiceCityID || int(addressVersion.Int64) != input.Evidence.AddressVersion) {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	var orderAddressID, orderAddressVersion, orderAddressText, orderAddressLatitude, orderAddressLongitude, serviceabilityPolicy, serviceabilityStatus, serviceabilityAddressVersion any
	if !pickup {
		orderAddressID, orderAddressVersion, orderAddressText = input.AddressID, int(addressVersion.Int64), addressText.String
		orderAddressLatitude, orderAddressLongitude = latitude.Float64, longitude.Float64
		serviceabilityPolicy, serviceabilityStatus, serviceabilityAddressVersion = input.Evidence.PolicyVersion, input.Evidence.Status, input.Evidence.AddressVersion
	}
	lineRows, err := tx.QueryContext(ctx, "SELECT id,store_offer_id,variant_id,quantity_base_units,selected_modifier_option_ids FROM dsh.commerce_cart_lines WHERE cart_id=$1 AND removed_at IS NULL ORDER BY created_at,id", input.CartID)
	if err != nil {
		return OrderRecord{}, false, err
	}
	type checkoutLine struct {
		id, offerID, variantID string
		quantity               int64
		modifiers              []string
		offer                  CatalogStoreOfferRecord
		modifierOptions        []CatalogModifierOptionRecord
		modifierAmount         int64
		amount                 int64
		inventoryReserved      int64
	}
	type cartLine struct {
		id, offerID, variantID string
		quantity               int64
		modifiers              []string
	}
	cartLines := make([]cartLine, 0)
	for lineRows.Next() {
		var line cartLine
		if err := lineRows.Scan(&line.id, &line.offerID, &line.variantID, &line.quantity, pq.Array(&line.modifiers)); err != nil {
			_ = lineRows.Close()
			return OrderRecord{}, false, err
		}
		cartLines = append(cartLines, line)
	}
	if err := lineRows.Err(); err != nil {
		_ = lineRows.Close()
		return OrderRecord{}, false, err
	}
	if err := lineRows.Close(); err != nil {
		return OrderRecord{}, false, err
	}
	lines := make([]checkoutLine, 0)
	var total int64
	var orderSizeBaseUnits int64
	for _, rawLine := range cartLines {
		line := checkoutLine{id: rawLine.id, offerID: rawLine.offerID, variantID: rawLine.variantID, quantity: rawLine.quantity, modifiers: rawLine.modifiers}
		if line.variantID == "" {
			return OrderRecord{}, false, ErrCheckoutEvidenceStale
		}
		line.offer, err = readCustomerVisibleOfferTx(ctx, tx, input.StoreID, line.offerID)
		if errors.Is(err, sql.ErrNoRows) {
			return OrderRecord{}, false, ErrCartOfferUnavailable
		}
		if err != nil || line.offer.VariantID != line.variantID {
			if err != nil {
				return OrderRecord{}, false, err
			}
			return OrderRecord{}, false, ErrCheckoutEvidenceStale
		}
		if err = validateCatalogOfferQuantity(line.offer, line.quantity); err != nil {
			return OrderRecord{}, false, err
		}
		var modifierDelta int64
		line.modifierOptions, modifierDelta, err = ValidateCatalogModifierSelection(ctx, tx, line.offer.ID, line.modifiers)
		if err != nil {
			return OrderRecord{}, false, err
		}
		line.modifierAmount, err = CalculateCatalogModifierAmount(modifierDelta, line.quantity)
		if err != nil {
			return OrderRecord{}, false, err
		}
		baseAmount, err := CalculateCatalogLineAmount(line.offer.PriceMinor, line.quantity, line.offer.PricingBasis, line.offer.PricingUnitBaseUnits)
		if err != nil {
			return OrderRecord{}, false, err
		}
		line.amount, err = AddCatalogModifierAmount(baseAmount, modifierDelta, line.quantity)
		if err != nil {
			return OrderRecord{}, false, err
		}
		line.inventoryReserved, err = reserveCatalogOfferInventoryTx(ctx, tx, line.offer.ID, line.quantity)
		if err != nil {
			return OrderRecord{}, false, err
		}
		combined := new(big.Int).Add(big.NewInt(total), big.NewInt(line.amount))
		if !combined.IsInt64() {
			return OrderRecord{}, false, ErrCheckoutEvidenceStale
		}
		total = combined.Int64()
		combinedSize := new(big.Int).Add(big.NewInt(orderSizeBaseUnits), big.NewInt(line.quantity))
		if !combinedSize.IsInt64() {
			return OrderRecord{}, false, ErrCheckoutEvidenceStale
		}
		orderSizeBaseUnits = combinedSize.Int64()
		lines = append(lines, line)
	}
	if len(lines) == 0 || total <= 0 {
		return OrderRecord{}, false, ErrCartEmpty
	}
	promotionCode := strings.ToUpper(strings.TrimSpace(input.PromotionCode))
	var promotion PromotionRecord
	var discountMinor int64
	if promotionCode != "" {
		evalLines := make([]PromotionEvalLine, 0, len(lines))
		for _, line := range lines {
			evalLines = append(evalLines, PromotionEvalLine{ProductID: line.offer.Product.ID, AmountMinor: line.amount})
		}
		promotion, discountMinor, err = EvaluatePromotion(ctx, tx, promotionCode, input.StoreID, input.Evidence.ServiceCityID, input.ClientActorID, total, evalLines, true)
		if err != nil {
			return OrderRecord{}, false, err
		}
	}
	// Every delivery uses the shared city policy; customer pickup remains fee-free.
	requiresDeliveryFee := input.FulfillmentMode == FulfillmentModeBthwaniCaptain || input.FulfillmentMode == FulfillmentModePartnerCaptain
	if orderSizeBaseUnits <= 0 || (requiresDeliveryFee && input.DeliveryFeeResolver == nil) {
		return OrderRecord{}, false, ErrDeliveryFeeUnavailable
	}
	feeQuote := DeliveryFeeQuote{FeeMinor: 0, PolicyVersion: "NOT_APPLICABLE"}
	if requiresDeliveryFee {
		feeQuote, err = input.DeliveryFeeResolver(ctx, DeliveryFeeQuoteInput{StoreID: input.StoreID, FulfillmentMode: input.FulfillmentMode, ServiceCityID: input.Evidence.ServiceCityID, OriginLatitude: input.Evidence.StoreOriginLatitude, OriginLongitude: input.Evidence.StoreOriginLongitude, DestinationLatitude: input.Evidence.AddressLatitude, DestinationLongitude: input.Evidence.AddressLongitude, OrderSizeBaseUnits: orderSizeBaseUnits})
		if err != nil || feeQuote.FeeMinor < 0 || strings.TrimSpace(feeQuote.PolicyVersion) == "" {
			return OrderRecord{}, false, ErrDeliveryFeeUnavailable
		}
	}
	chargeableSubtotal := new(big.Int).Sub(big.NewInt(total), big.NewInt(discountMinor))
	orderTotal := new(big.Int).Add(chargeableSubtotal, big.NewInt(feeQuote.FeeMinor))
	if !orderTotal.IsInt64() || orderTotal.Int64() <= 0 {
		return OrderRecord{}, false, ErrDeliveryFeeUnavailable
	}
	totalWithDelivery := orderTotal.Int64()
	if !checkoutTotalMatchesConfirmation(input.ExpectedTotalAmountMinor, totalWithDelivery) {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if input.InternalBalanceAmountMinor < 0 || input.InternalBalanceAmountMinor > totalWithDelivery {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	newOrderID := stableCheckoutOrderID(input.ClientActorID, input.CartID, input.IdempotencyKey)
	deliveryProofCode, err := newDeliveryProofCode()
	if err != nil {
		return OrderRecord{}, false, err
	}
	proofKeyID, proofCiphertext, err := input.DeliveryProofKeyring.Encrypt(newOrderID, deliveryProofCode)
	if err != nil {
		return OrderRecord{}, false, err
	}
	proofVerifier, err := input.DeliveryProofKeyring.ProofVerifier(newOrderID, proofKeyID, deliveryProofCode)
	if err != nil {
		return OrderRecord{}, false, err
	}
	orderability, err := lockAndEvaluateStoreOrderability(ctx, tx, input.StoreID, input.FulfillmentMode)
	if err != nil {
		return OrderRecord{}, false, err
	}
	if orderability.State != StoreOrderabilityOpenForOrders || orderability.Version < 1 {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	promotionFunding := PromotionFunding{}
	if promotion.ID != "" {
		promotionFunding = PromotionFunding{PromotionID: promotion.ID, PromotionVersion: promotion.Version, PromotionCode: promotion.Code, FundingSource: promotion.FundingSource, PartnerSharePercent: promotion.FundingSharePartnerPercent}
	}
	payment, err := input.PaymentProvisioner(ctx, newOrderID, input.PaymentExternalReference, input.ClientActorID, total, discountMinor, feeQuote.FeeMinor, feeQuote.PlatformMarginMinor, feeQuote.PolicyVersion, totalWithDelivery, promotionFunding, input.PaymentIdempotencyKey, input.CorrelationID)
	if err != nil {
		return OrderRecord{}, false, fmt.Errorf("%w: %w", ErrPaymentProvisioning, err)
	}
	paymentIntentID = strings.TrimSpace(payment.IntentID)
	if paymentIntentID == "" {
		return OrderRecord{}, false, fmt.Errorf("%w: %w", ErrExternalOutcomeUnknown, ErrPaymentProvisioning)
	}
	if payment.State != "REQUIRES_COLLECTION" {
		return OrderRecord{}, false, ErrPaymentProvisioning
	}
	if payment.CashAmountMinor < 0 || payment.CashAmountMinor > totalWithDelivery || payment.CashAmountMinor != totalWithDelivery-input.InternalBalanceAmountMinor {
		return OrderRecord{}, false, ErrPaymentProvisioning
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,fulfillment_mode,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,subtotal_amount_minor,discount_minor,promotion_id,promotion_code,promotion_version,promotion_funding_source,promotion_funding_share_partner_percent,total_amount_minor,payment_cash_amount_minor,payment_intent_id,payment_method,payment_state,recipient_mode,recipient_name,recipient_phone_e164,recipient_instructions,cancellation_mode,cancellation_policy_version,customer_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'CREATED',$16,$17,NULLIF($18,''),NULLIF($19,''),NULLIF($20,0),NULLIF($21,''),$22,$23,$24,$25,$26,$27,$28,NULLIF($29,''),NULLIF($30,''),NULLIF($31,''),COALESCE((SELECT type.cancellation_mode FROM dsh.stores store JOIN dsh.commercial_store_types type ON type.id=store.commercial_store_type_id WHERE store.id=$3),'OPERATIONS_ONLY'),COALESCE((SELECT type.version FROM dsh.stores store JOIN dsh.commercial_store_types type ON type.id=store.commercial_store_type_id WHERE store.id=$3),0),$32)`, newOrderID, input.ClientActorID, input.StoreID, input.CartID, input.FulfillmentMode, orderAddressID, orderAddressVersion, orderAddressText, orderAddressLatitude, orderAddressLongitude, input.Evidence.ServiceCityID, serviceabilityPolicy, serviceabilityStatus, storeVersion, serviceabilityAddressVersion, total, discountMinor, promotion.ID, promotion.Code, promotion.Version, promotion.FundingSource, promotion.FundingSharePartnerPercent, totalWithDelivery, payment.CashAmountMinor, payment.IntentID, input.PaymentMethod, payment.State, input.Recipient.Mode, input.Recipient.Name, input.Recipient.PhoneE164, input.Recipient.Instructions, input.CustomerNote); err != nil {
		return OrderRecord{}, false, err
	}
	// Bind a server-acknowledged click to the Order before its transaction commits.
	// Invalid, stale or superseded clicks leave checkout valid and unattributed.
	if err := RecordCheckoutDiscoveryConversionTx(ctx, tx, newOrderID, input.ClientActorID, input.DiscoveryClickEventID); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_store_orderability_snapshots(order_id,availability_version,orderability_state,evaluated_at) VALUES($1,$2,$3,$4)`, newOrderID, orderability.Version, orderability.State, orderability.EvaluatedAt); err != nil {
		return OrderRecord{}, false, fmt.Errorf("record checkout Store orderability evidence: %w", err)
	}
	if promotion.ID != "" {
		if err := RedeemPromotion(ctx, tx, promotion, input.ClientActorID, newOrderID, discountMinor); err != nil {
			return OrderRecord{}, false, err
		}
	}
	proofType := "DELIVERY"
	if pickup {
		proofType = "STORE_PICKUP"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_delivery_proofs(order_id,client_actor_id,code_ciphertext,code_verifier,code_key_id,proof_type) VALUES($1,$2,$3,$4,$5,$6)`, newOrderID, input.ClientActorID, proofCiphertext, proofVerifier, proofKeyID, proofType); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_payment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,payment_intent_id,from_state,to_state,amount_minor) VALUES('payment_intent_linked',$1,$2,$3,$4,$5,'NOT_LINKED',$6,$7)`, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, newOrderID, payment.IntentID, payment.State, totalWithDelivery); err != nil {
		return OrderRecord{}, false, err
	}
	for _, line := range lines {
		lineID, idErr := newID("orderline")
		if idErr != nil {
			return OrderRecord{}, false, idErr
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_lines(id,order_id,store_offer_id,variant_id,product_id,product_name,variant_title,measurement_kind,base_unit,pricing_basis,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_unit_base_units,requested_quantity_base_units,final_quantity_base_units,inventory_reserved_base_units,unit_price_minor,line_amount_minor,currency,selected_modifier_option_ids,modifier_amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`, lineID, newOrderID, line.offer.ID, line.offer.VariantID, line.offer.Product.ID, line.offer.Product.CanonicalName, line.offer.Variant.Title, line.offer.Variant.MeasurementKind, line.offer.Variant.BaseUnit, line.offer.PricingBasis, line.offer.QuantityPolicy, quantityValue(line.offer.QuantityMinBaseUnits), quantityValue(line.offer.QuantityMaxBaseUnits), quantityValue(line.offer.QuantityStepBaseUnits), line.offer.PricingUnitBaseUnits, line.quantity, line.quantity, line.inventoryReserved, line.offer.PriceMinor, line.amount, line.offer.Currency, pq.Array(line.modifiers), line.modifierAmount); err != nil {
			return OrderRecord{}, false, err
		}
		for _, option := range line.modifierOptions {
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_line_modifier_snapshots(order_line_id,option_id,option_name_ar,price_delta_minor) VALUES($1,$2,$3,$4)`, lineID, option.ID, option.NameAr, option.PriceDeltaMinor); err != nil {
				return OrderRecord{}, false, err
			}
		}
		attributes := make(map[string]CatalogAttributeValueRecord, len(line.offer.Product.Attributes)+len(line.offer.Variant.Attributes))
		for _, attribute := range line.offer.Product.Attributes {
			attributes[attribute.AttributeID] = attribute
		}
		for _, attribute := range line.offer.Variant.Attributes {
			attributes[attribute.AttributeID] = attribute
		}
		for _, attribute := range attributes {
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_line_attribute_snapshots(order_line_id,attribute_id,attribute_code,value_kind,text_value,integer_value,decimal_value,boolean_value,enum_value,date_value,measurement_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, lineID, attribute.AttributeID, attribute.Code, attribute.ValueKind, attribute.TextValue, attribute.IntegerValue, attribute.DecimalValue, attribute.BooleanValue, attribute.EnumValue, attribute.DateValue, attribute.MeasurementUnit); err != nil {
				return OrderRecord{}, false, err
			}
		}
	}
	cartUpdateResult, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_carts SET state='checked_out',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='open' AND version=$2", input.CartID, input.ExpectedCartVersion)
	if err != nil {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if rowsAffected, err := cartUpdateResult.RowsAffected(); err != nil || rowsAffected != 1 {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_checkout_idempotency(idempotency_key,request_hash,cart_id,order_id,result_version) VALUES($1,$2,$3,$4,1)", input.IdempotencyKey, input.RequestHash, input.CartID, newOrderID); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES('order_created',$1,$2,$3,$4,NULL,'CREATED',NULL,1,$5)`, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, newOrderID, input.RequestHash); err != nil {
		return OrderRecord{}, false, err
	}
	commitAttempted = true
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, fmt.Errorf("%w: %w", ErrExternalOutcomeUnknown, err)
	}
	order, err = ReadOrder(ctx, db, newOrderID)
	if err != nil {
		return OrderRecord{}, false, fmt.Errorf("%w: %w", ErrExternalOutcomeUnknown, err)
	}
	return order, false, nil
}
