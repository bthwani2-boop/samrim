package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

// IndependentPickupQuote is a read-only, owner-priced estimate. It is not
// a payment intent, reservation, phone proof, or permission to submit orders.
// No public HTTP route is registered until guest and legal gates are approved.
type IndependentPickupQuote struct {
	StoreID               string                       `json:"storeId"`
	StoreName             string                       `json:"storeName"`
	ServiceCityID         string                       `json:"serviceCityId"`
	PickupLatitude        float64                      `json:"pickupLatitude"`
	PickupLongitude       float64                      `json:"pickupLongitude"`
	HostingTermsVersion   string                       `json:"hostingTermsVersion"`
	MerchantPolicyVersion string                       `json:"merchantPolicyVersion"`
	CancellationTerms     string                       `json:"cancellationTerms"`
	ReturnsTerms          string                       `json:"returnsTerms"`
	FulfillmentTerms      string                       `json:"fulfillmentTerms"`
	CollectionTerms       string                       `json:"collectionTerms"`
	Lines                 []IndependentPickupQuoteLine `json:"lines"`
	SubtotalMinor         int64                        `json:"subtotalMinor"`
	DeliveryFeeMinor      int64                        `json:"deliveryFeeMinor"`
	TotalMinor            int64                        `json:"totalMinor"`
	Currency              string                       `json:"currency"`
	FulfillmentMode       string                       `json:"fulfillmentMode"`
	PaymentMethod         string                       `json:"paymentMethod"`
	ExpiresAt             time.Time                    `json:"expiresAt"`
}

type IndependentPickupQuoteLine struct {
	OfferID           string `json:"offerId"`
	ProductName       string `json:"productName"`
	VariantTitle      string `json:"variantTitle"`
	QuantityBaseUnits int64  `json:"quantityBaseUnits"`
	UnitPriceMinor    int64  `json:"unitPriceMinor"`
	LineAmountMinor   int64  `json:"lineAmountMinor"`
}

func normalizeIndependentPickupQuoteLines(lines []IndependentDirectOrderLineRequest) ([]IndependentDirectOrderLineRequest, error) {
	if len(lines) == 0 || len(lines) > 20 {
		return nil, ErrIndependentOrderInvalid
	}
	normalized := make([]IndependentDirectOrderLineRequest, len(lines))
	seen := make(map[string]struct{}, len(lines))
	for i, line := range lines {
		line.OfferID = strings.TrimSpace(line.OfferID)
		if line.OfferID == "" || len(line.OfferID) > 128 ||
			!utf8.ValidString(line.OfferID) || strings.ContainsAny(line.OfferID, "\x00\r\n") ||
			line.QuantityBaseUnits <= 0 {
			return nil, ErrIndependentOrderInvalid
		}
		if _, duplicate := seen[line.OfferID]; duplicate {
			return nil, ErrIndependentOrderInvalid
		}
		seen[line.OfferID] = struct{}{}
		normalized[i] = line
	}
	return normalized, nil
}

// QuoteIndependentPickup prices an approved independent Store and the exact
// requested Offer quantities under one read-only Postgres snapshot. Confirmation
// must revalidate the same facts through CreateIndependentPickupOrder; a quote
// never bypasses publication, Store relation, availability, or current prices.
func QuoteIndependentPickup(ctx context.Context, db *sql.DB, approvedTermsVersion, storeID string, cart []IndependentDirectOrderLineRequest) (IndependentPickupQuote, error) {
	storeID = strings.TrimSpace(storeID)
	approvedTermsVersion = strings.TrimSpace(approvedTermsVersion)
	lines, err := normalizeIndependentPickupQuoteLines(cart)
	if err != nil {
		return IndependentPickupQuote{}, err
	}
	if db == nil || storeID == "" || len(storeID) > 128 ||
		!utf8.ValidString(storeID) || strings.ContainsAny(storeID, "\x00\r\n") || approvedTermsVersion == "" {
		return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return IndependentPickupQuote{}, err
	}
	defer func() { _ = tx.Rollback() }()
	published, err := readPublishedIndependentStoreWithQueryer(ctx, tx, storeID, approvedTermsVersion)
	if errors.Is(err, ErrIndependentStorefrontNotPublished) {
		return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
	}
	if err != nil {
		return IndependentPickupQuote{}, err
	}
	if published.MerchantPolicyVersion == "" || published.CancellationTerms == "" ||
		published.ReturnsTerms == "" || published.FulfillmentTerms == "" || published.CollectionTerms == "" {
		return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
	}
	var pickupLat, pickupLong sql.NullFloat64
	if err := tx.QueryRowContext(ctx, `SELECT delivery_origin_latitude,delivery_origin_longitude
		FROM dsh.stores WHERE id=$1 AND relation_model='INDEPENDENT_STORE'
		AND deleted_at IS NULL AND 'CUSTOMER_PICKUP'=ANY(fulfillment_modes)`, storeID).Scan(&pickupLat, &pickupLong); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
		}
		return IndependentPickupQuote{}, err
	}
	if !pickupLat.Valid || !pickupLong.Valid {
		return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
	}
	availability, err := readStoreOperationalAvailabilityRow(ctx, tx.QueryRowContext(ctx, `SELECT
		store_id,schedule_mode,schedule_timezone,weekly_schedule,
		paused,pause_reason,pause_until,preparation_minutes,unavailable_fulfillment_modes,
		version,updated_by_actor_id,updated_at
		FROM dsh.store_operational_availability WHERE store_id=$1`, storeID))
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
	}
	if err != nil {
		return IndependentPickupQuote{}, err
	}
	if availability.ScheduleMode == "ALWAYS_OPEN" && availability.Version == 1 &&
		(availability.UpdatedByActorID == "system:lazy-initialize" || availability.UpdatedByActorID == "system:checkout-initialize") {
		return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
	}
	checkedAt := time.Now().UTC()
	orderability, err := evaluateStoreOrderability(availability, "CUSTOMER_PICKUP", checkedAt)
	if err != nil {
		return IndependentPickupQuote{}, err
	}
	if orderability.State != StoreOrderabilityOpenForOrders {
		return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
	}
	quote := IndependentPickupQuote{
		StoreID: storeID, StoreName: published.Name, ServiceCityID: published.ServiceCityID,
		PickupLatitude: pickupLat.Float64, PickupLongitude: pickupLong.Float64,
		HostingTermsVersion: published.HostingTermsVersion, MerchantPolicyVersion: published.MerchantPolicyVersion,
		CancellationTerms: published.CancellationTerms, ReturnsTerms: published.ReturnsTerms,
		FulfillmentTerms: published.FulfillmentTerms, CollectionTerms: published.CollectionTerms,
		Currency: "YER", FulfillmentMode: "CUSTOMER_PICKUP", PaymentMethod: "MERCHANT_DIRECT_AT_FULFILLMENT",
		ExpiresAt: checkedAt.Add(2 * time.Minute),
		Lines:     make([]IndependentPickupQuoteLine, 0, len(lines)),
	}
	for _, request := range lines {
		var row independentOrderLine
		var minQty, maxQty, stepQty, priceUnit sql.NullInt64
		var pricingBasis, inventoryPolicy string
		err := tx.QueryRowContext(ctx, independentDirectOrderOfferBaseQuery, request.OfferID, storeID).
			Scan(&row.offerID, &row.variantID, &row.productID, &row.productName, &row.variantTitle,
				&row.unitPrice, &minQty, &maxQty, &stepQty, &priceUnit, &pricingBasis, &inventoryPolicy)
		if errors.Is(err, sql.ErrNoRows) {
			return IndependentPickupQuote{}, ErrIndependentOrderUnavailable
		}
		if err != nil {
			return IndependentPickupQuote{}, fmt.Errorf("read independent quote offer: %w", err)
		}
		if !independentDirectUnitOfferSupported(pricingBasis, inventoryPolicy, priceUnit) ||
			!minQty.Valid || !maxQty.Valid || !stepQty.Valid ||
			minQty.Int64 <= 0 || stepQty.Int64 <= 0 || maxQty.Int64 < minQty.Int64 ||
			request.QuantityBaseUnits < minQty.Int64 || request.QuantityBaseUnits > maxQty.Int64 ||
			(request.QuantityBaseUnits-minQty.Int64)%stepQty.Int64 != 0 {
			return IndependentPickupQuote{}, ErrIndependentOrderQuote
		}
		lineAmount, err := independentLineAmount(row.unitPrice, request.QuantityBaseUnits, priceUnit.Int64)
		if err != nil || lineAmount > math.MaxInt64-quote.SubtotalMinor {
			return IndependentPickupQuote{}, ErrIndependentOrderQuote
		}
		quote.SubtotalMinor += lineAmount
		quote.Lines = append(quote.Lines, IndependentPickupQuoteLine{
			OfferID: request.OfferID, ProductName: row.productName, VariantTitle: row.variantTitle,
			QuantityBaseUnits: request.QuantityBaseUnits, UnitPriceMinor: row.unitPrice, LineAmountMinor: lineAmount,
		})
	}
	// This admitted pickup writer currently has no merchant delivery fee or
	// independent tax rail; it charges exactly the DSH product subtotal.
	quote.TotalMinor = quote.SubtotalMinor
	if err := tx.Commit(); err != nil {
		return IndependentPickupQuote{}, err
	}
	return quote, nil
}
