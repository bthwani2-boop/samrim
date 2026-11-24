package customercart

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

// Review is a non-persisted, version-bound DSH snapshot, not a quote or Order.
// Recipient contact is validated, never returned, logged, persisted or sent to WLT.
type checkoutReviewInput struct {
	ExpectedCartVersion    int64
	AddressID              string
	ExpectedAddressVersion int64
	RecipientPurpose       string
	RecipientName          string
	RecipientPhone         string
	DeliveryInstructions   string
	FulfillmentMode        string
}

type checkoutReviewResult struct {
	ActorID          string                                     `json:"actorId"`
	StoreID          string                                     `json:"storeId"`
	CartVersion      int64                                      `json:"cartVersion"`
	RecipientPurpose string                                     `json:"recipientPurpose"`
	FulfillmentMode  string                                     `json:"fulfillmentMode"`
	Merchandise      MerchandiseEstimate                        `json:"merchandise"`
	Delivery         *DeliveryServiceability                    `json:"delivery,omitempty"`
	DistanceFee      *DistanceFeeEstimate                       `json:"distanceFeeEstimate,omitempty"`
	CheckoutReady    bool                                       `json:"checkoutReady"`
	Blockers         []string                                   `json:"blockers"`
	StoreSchedule    storeavailability.CustomerScheduleEvidence `json:"storeSchedule"`
}

var checkoutRecipientPhone = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

func validRecipientText(v string, max int) bool {
	return utf8.ValidString(v) && v == strings.TrimSpace(v) && utf8.RuneCountInString(v) >= 1 &&
		utf8.RuneCountInString(v) <= max && !strings.ContainsFunc(v, func(r rune) bool {
		return unicode.IsControl(r) || r == unicode.ReplacementChar || unicode.Is(unicode.Cf, r)
	})
}

func decodeCheckoutReview(w http.ResponseWriter, r *http.Request) (checkoutReviewInput, bool) {
	var v checkoutReviewInput
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.Header.Get("Content-Encoding") != "" ||
		r.URL.RawQuery != "" || r.URL.ForceQuery || !resourceRule.MatchString(r.PathValue("storeID")) {
		return v, false
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
	if err != nil || !utf8.Valid(body) {
		return v, false
	}
	d := json.NewDecoder(bytes.NewReader(body))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return v, false
	}
	seen := map[string]bool{}
	for d.More() {
		raw, err := d.Token()
		key, ok := raw.(string)
		if err != nil || !ok || seen[key] {
			return v, false
		}
		seen[key] = true
		var field any
		switch key {
		case "expectedCartVersion":
			field = &v.ExpectedCartVersion
		case "addressId":
			field = &v.AddressID
		case "expectedAddressVersion":
			field = &v.ExpectedAddressVersion
		case "recipientPurpose":
			field = &v.RecipientPurpose
		case "recipientName":
			field = &v.RecipientName
		case "recipientPhone":
			field = &v.RecipientPhone
		case "deliveryInstructions":
			field = &v.DeliveryInstructions
		case "fulfillmentMode":
			field = &v.FulfillmentMode
		default:
			return v, false
		}
		var value json.RawMessage
		if d.Decode(&value) != nil || bytes.Equal(bytes.TrimSpace(value), []byte("null")) || json.Unmarshal(value, field) != nil {
			return v, false
		}
	}
	end, err := d.Token()
	if err != nil || end != json.Delim('}') || d.Decode(new(any)) != io.EOF ||
		!seen["expectedCartVersion"] || v.ExpectedCartVersion < 1 || v.ExpectedCartVersion > maxJSONSafeInteger {
		return v, false
	}
	switch v.RecipientPurpose {
	case "SELF":
		if seen["recipientName"] || seen["recipientPhone"] || seen["deliveryInstructions"] {
			return v, false
		}
	case "OTHER":
		if !validRecipientText(v.RecipientName, 100) || !checkoutRecipientPhone.MatchString(v.RecipientPhone) ||
			(seen["deliveryInstructions"] && !validRecipientText(v.DeliveryInstructions, 300)) {
			return v, false
		}
	default:
		return v, false
	}
	switch v.FulfillmentMode {
	case "CUSTOMER_PICKUP":
		if seen["addressId"] || seen["expectedAddressVersion"] || seen["deliveryInstructions"] {
			return v, false
		}
	case "BTHWANI_CAPTAIN", "PARTNER_CAPTAIN":
		if !addressIDRule.MatchString(v.AddressID) || v.ExpectedAddressVersion < 1 || v.ExpectedAddressVersion > maxJSONSafeInteger {
			return v, false
		}
	default:
		return v, false
	}
	return v, true
}

func (h *Handler) checkoutReview(w http.ResponseWriter, r *http.Request) {
	input, valid := decodeCheckoutReview(w, r)
	if !valid {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	token := tokenOf(r)
	actor, status := h.actor(ctx, token)
	if status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	store := r.PathValue("storeID")
	tx, err := h.begin(ctx, false)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	cart, err := snapshot(ctx, tx, actor, store)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if cart.Version != input.ExpectedCartVersion {
		fail(w, 409, "CART_VERSION_CONFLICT")
		return
	}
	amount, code := estimateFromSnapshot(cart)
	if code != "" {
		fail(w, 409, code)
		return
	}
	result := checkoutReviewResult{ActorID: actor, StoreID: store, CartVersion: cart.Version,
		RecipientPurpose: input.RecipientPurpose, FulfillmentMode: input.FulfillmentMode, Merchandise: amount,
		CheckoutReady: false, Blockers: []string{"FULFILLMENT_MODE_NOT_ADMITTED", "PAYABLE_QUOTE_NOT_AVAILABLE", "PAYMENT_ALLOCATION_NOT_AVAILABLE"}}
	var scheduleJSON []byte
	var evaluatedAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT `+storeavailability.PublicScheduleSQL+`,transaction_timestamp()
	FROM stores s JOIN service_cities c ON c.id=s.city_id
	WHERE s.id=$1 AND s.published AND c.active`, store).Scan(&scheduleJSON, &evaluatedAt)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	result.StoreSchedule = storeavailability.EvaluateCustomerSchedule(evaluatedAt, scheduleJSON)
	if input.AddressID != "" {
		delivery, err := readDeliveryServiceability(ctx, tx, actor, store, input.AddressID)
		if err != nil {
			fail(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		if delivery.Evidence == nil {
			fail(w, 409, "ADDRESS_OR_SERVICEABILITY_UNAVAILABLE")
			return
		}
		if delivery.Evidence.AddressVersion != input.ExpectedAddressVersion {
			fail(w, 409, "ADDRESS_VERSION_CONFLICT")
			return
		}
		result.Delivery = &delivery
		result.DistanceFee, err = readDistanceFeeEstimate(ctx, tx, delivery)
		if err != nil {
			fail(w, 503, "OWNER_UNAVAILABLE")
			return
		}
		if delivery.Status != "SERVICEABLE" {
			result.Blockers = append(result.Blockers, "ADDRESS_UNSERVICEABLE")
		}
	}
	if tx.Commit() != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if status = h.stillCurrent(ctx, token, actor); status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	reply(w, result)
}
