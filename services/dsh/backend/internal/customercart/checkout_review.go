package customercart

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
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
	SalesChannel           string
	ExpectedCartVersion    int64
	AddressID              string
	ExpectedAddressVersion int64
	RecipientPurpose       string
	RecipientName          string
	RecipientPhone         string
	DeliveryInstructions   string
	FulfillmentMode        string
}

// Required fields have no admissible zero value. Raw optional fields preserve
// presence, so explicit null cannot be mistaken for an omitted field.
type checkoutReviewWire struct {
	SalesChannel           string         `json:"salesChannel"`
	ExpectedCartVersion    int64          `json:"expectedCartVersion"`
	RecipientPurpose       string         `json:"recipientPurpose"`
	FulfillmentMode        string         `json:"fulfillmentMode"`
	AddressID              jsontext.Value `json:"addressId"`
	ExpectedAddressVersion jsontext.Value `json:"expectedAddressVersion"`
	RecipientName          jsontext.Value `json:"recipientName"`
	RecipientPhone         jsontext.Value `json:"recipientPhone"`
	DeliveryInstructions   jsontext.Value `json:"deliveryInstructions"`
}

type checkoutReviewResult struct {
	ActorID          string                                     `json:"actorId"`
	StoreID          string                                     `json:"storeId"`
	CartVersion      int64                                      `json:"cartVersion"`
	SalesChannel     string                                     `json:"salesChannel"`
	RecipientPurpose string                                     `json:"recipientPurpose"`
	FulfillmentMode  string                                     `json:"fulfillmentMode"`
	Merchandise      MerchandiseEstimate                        `json:"merchandise"`
	Delivery         *DeliveryServiceability                    `json:"delivery,omitempty"`
	DistanceFee      *DistanceFeeEstimate                       `json:"distanceFeeEstimate,omitempty"`
	CheckoutReady    bool                                       `json:"checkoutReady"`
	Blockers         []string                                   `json:"blockers"`
	StoreSchedule    storeavailability.CustomerScheduleEvidence `json:"storeSchedule"`
}

const checkoutReviewMaxBody = 4096

var checkoutRecipientPhone = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

func validRecipientText(v string, max int) bool {
	return utf8.ValidString(v) && v == strings.TrimSpace(v) && utf8.RuneCountInString(v) >= 1 &&
		utf8.RuneCountInString(v) <= max && !strings.ContainsFunc(v, func(r rune) bool {
		return unicode.IsControl(r) || r == unicode.ReplacementChar || unicode.Is(unicode.Cf, r)
	})
}

func validCheckoutEnvelope(r *http.Request) bool {
	media := r.Header.Values("Content-Type")
	if len(media) != 1 || len(r.Header.Values("Content-Encoding")) != 0 ||
		r.URL.RawQuery != "" || r.URL.ForceQuery || !resourceRule.MatchString(r.PathValue("storeID")) ||
		r.Body == nil || r.ContentLength > checkoutReviewMaxBody {
		return false
	}
	kind, params, err := mime.ParseMediaType(media[0])
	if err != nil || kind != "application/json" {
		return false
	}
	for key, value := range params {
		if key != "charset" || !strings.EqualFold(value, "utf-8") {
			return false
		}
	}
	return true
}

func checkoutOptional[T any](raw jsontext.Value, dst *T) bool {
	return len(raw) == 0 || (string(raw) != "null" && json.Unmarshal(raw, dst) == nil)
}

func admitCheckoutReview(wire checkoutReviewWire) (checkoutReviewInput, bool) {
	v := checkoutReviewInput{
		SalesChannel: wire.SalesChannel, ExpectedCartVersion: wire.ExpectedCartVersion,
		RecipientPurpose: wire.RecipientPurpose, FulfillmentMode: wire.FulfillmentMode,
	}
	if v.ExpectedCartVersion < 1 || v.ExpectedCartVersion > maxJSONSafeInteger ||
		(v.SalesChannel != "DIRECT" && v.SalesChannel != "MARKETPLACE") ||
		!checkoutOptional(wire.AddressID, &v.AddressID) ||
		!checkoutOptional(wire.ExpectedAddressVersion, &v.ExpectedAddressVersion) ||
		!checkoutOptional(wire.RecipientName, &v.RecipientName) ||
		!checkoutOptional(wire.RecipientPhone, &v.RecipientPhone) ||
		!checkoutOptional(wire.DeliveryInstructions, &v.DeliveryInstructions) {
		return checkoutReviewInput{}, false
	}
	switch v.RecipientPurpose {
	case "SELF":
		if len(wire.RecipientName) != 0 || len(wire.RecipientPhone) != 0 || len(wire.DeliveryInstructions) != 0 {
			return checkoutReviewInput{}, false
		}
	case "OTHER":
		if !validRecipientText(v.RecipientName, 100) || !checkoutRecipientPhone.MatchString(v.RecipientPhone) ||
			(len(wire.DeliveryInstructions) != 0 && !validRecipientText(v.DeliveryInstructions, 300)) {
			return checkoutReviewInput{}, false
		}
	default:
		return checkoutReviewInput{}, false
	}
	switch v.FulfillmentMode {
	case "CUSTOMER_PICKUP":
		if len(wire.AddressID) != 0 || len(wire.ExpectedAddressVersion) != 0 || len(wire.DeliveryInstructions) != 0 {
			return checkoutReviewInput{}, false
		}
	case "BTHWANI_CAPTAIN", "PARTNER_CAPTAIN":
		if !addressIDRule.MatchString(v.AddressID) || v.ExpectedAddressVersion < 1 || v.ExpectedAddressVersion > maxJSONSafeInteger {
			return checkoutReviewInput{}, false
		}
	default:
		return checkoutReviewInput{}, false
	}
	return v, true
}

func decodeCheckoutReview(w http.ResponseWriter, r *http.Request) (checkoutReviewInput, bool) {
	if !validCheckoutEnvelope(r) {
		return checkoutReviewInput{}, false
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, checkoutReviewMaxBody))
	if err != nil {
		return checkoutReviewInput{}, false
	}
	var wire checkoutReviewWire
	// JSON v2 rejects duplicate names, invalid Unicode and case variants.
	if err := json.Unmarshal(body, &wire, json.RejectUnknownMembers(true)); err != nil {
		return checkoutReviewInput{}, false
	}
	return admitCheckoutReview(wire)
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
	relations := append(snapshotRelations(), "store_operational_availability", "store_operational_weekly_hours")
	if input.AddressID != "" {
		relations = append(relations, "customer_addresses", "service_city_delivery_policies")
	}
	tx, err := h.begin(ctx, false, relations...)
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
	// Read the current Store relation in the same repeatable-read transaction
	// as the cart, publication and offer evidence. The caller requests a
	// channel; it never grants itself eligibility or financial rights.
	var eligible bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM stores s JOIN service_cities c ON c.id=s.city_id
		JOIN verticals v ON v.id=s.vertical_id
		WHERE s.id=$1 AND s.published AND c.active AND v.active
		AND (($2='DIRECT' AND s.relation IN ('DIRECT','MARKETPLACE'))
		  OR ($2='MARKETPLACE' AND s.relation='MARKETPLACE'))
	)`, store, input.SalesChannel).Scan(&eligible)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if !eligible {
		fail(w, 409, "SALES_CHANNEL_NOT_ELIGIBLE")
		return
	}
	result := checkoutReviewResult{ActorID: actor, StoreID: store, CartVersion: cart.Version, SalesChannel: input.SalesChannel,
		RecipientPurpose: input.RecipientPurpose, FulfillmentMode: input.FulfillmentMode, Merchandise: amount,
		CheckoutReady: false, Blockers: []string{"FULFILLMENT_MODE_NOT_ADMITTED", "PAYABLE_QUOTE_NOT_AVAILABLE", "PAYMENT_ALLOCATION_NOT_AVAILABLE"}}
	result.StoreSchedule, err = storeavailability.ReadCustomerSchedule(ctx, tx, store)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
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
