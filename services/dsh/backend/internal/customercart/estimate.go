package customercart

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// MerchandiseEstimate is an owner-derived read-only amount for one current
// Customer Cart version. It is never a payable checkout quote, price hold,
// stock reservation, confirmed Order or authorization to collect money.
type MerchandiseEstimateLine struct {
	OfferID      string `json:"offerId"`
	VariantID    string `json:"variantId"`
	Quantity     int64  `json:"quantity"`
	UnitYER      string `json:"unitYer"`
	LineTotalYER string `json:"lineTotalYer"`
}
type MerchandiseEstimate struct {
	ActorID                string                    `json:"actorId"`
	StoreID                string                    `json:"storeId"`
	CartVersion            int64                     `json:"cartVersion"`
	Lines                  []MerchandiseEstimateLine `json:"lines"`
	MerchandiseSubtotalYER string                    `json:"merchandiseSubtotalYer"`
	CheckoutReady          bool                      `json:"checkoutReady"`
}

const maxJSONSafeInteger = 9007199254740991

// Only DSH's canonical current Offer values, read in one repeatable-read
// transaction, contribute to this non-payable merchandise estimate.
func estimateFromSnapshot(cart Snapshot) (MerchandiseEstimate, string) {
	if len(cart.Lines) == 0 || len(cart.Lines) > 20 {
		return MerchandiseEstimate{}, "CART_EMPTY_OR_TOO_LARGE"
	}
	if cart.Version < 1 || cart.Version > maxJSONSafeInteger {
		return MerchandiseEstimate{}, "CART_VERSION_CONFLICT"
	}
	estimate := MerchandiseEstimate{
		ActorID: cart.ActorID, StoreID: cart.StoreID, CartVersion: cart.Version,
		Lines:         make([]MerchandiseEstimateLine, 0, len(cart.Lines)),
		CheckoutReady: false,
	}
	var total int64
	for _, line := range cart.Lines {
		if !line.PreviewAvailable || line.Quantity <= 0 || line.Quantity > math.MaxInt32 {
			return MerchandiseEstimate{}, "CART_LINE_UNAVAILABLE"
		}
		price, err := strconv.ParseInt(line.PreviewUnitYER, 10, 64)
		if err != nil || price <= 0 {
			return MerchandiseEstimate{}, "CART_LINE_UNAVAILABLE"
		}
		if line.Quantity > math.MaxInt64/price {
			return MerchandiseEstimate{}, "MERCHANDISE_AMOUNT_OUT_OF_RANGE"
		}
		subtotal := line.Quantity * price
		if subtotal > math.MaxInt64-total {
			return MerchandiseEstimate{}, "MERCHANDISE_AMOUNT_OUT_OF_RANGE"
		}
		total += subtotal
		estimate.Lines = append(estimate.Lines, MerchandiseEstimateLine{
			OfferID: line.OfferID, VariantID: line.VariantID, Quantity: line.Quantity,
			UnitYER: strconv.FormatInt(price, 10), LineTotalYER: strconv.FormatInt(subtotal, 10),
		})
	}
	estimate.MerchandiseSubtotalYER = strconv.FormatInt(total, 10)
	return estimate, ""
}

func validExpectedVersion(r *http.Request) (int64, bool) {
	if !resourceRule.MatchString(r.PathValue("storeID")) || r.URL.ForceQuery ||
		r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		return 0, false
	}
	// Reject malformed encoded selectors; URL.Query silently drops errors.
	params, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(params) != 1 || len(params["expectedVersion"]) != 1 {
		return 0, false
	}
	raw := params.Get("expectedVersion")
	if raw == "" || len(raw) > 16 || (len(raw) > 1 && raw[0] == '0') {
		return 0, false
	}
	for _, char := range raw {
		if char < '0' || char > '9' {
			return 0, false
		}
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	return value, err == nil && value >= 0 && value <= maxJSONSafeInteger
}

func (h *Handler) merchandiseEstimate(w http.ResponseWriter, r *http.Request) {
	expectedVersion, valid := validExpectedVersion(r)
	if !valid {
		fail(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	token := tokenOf(r)
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	actor, status := h.actor(ctx, token)
	if status != http.StatusOK {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	tx, err := h.begin(ctx, false)
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	cart, err := snapshot(ctx, tx, actor, r.PathValue("storeID"))
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	if cart.Version != expectedVersion {
		fail(w, http.StatusConflict, "CART_VERSION_CONFLICT")
		return
	}
	estimate, code := estimateFromSnapshot(cart)
	if code != "" {
		fail(w, http.StatusConflict, code)
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	if status = h.stillCurrent(ctx, token, actor); status != http.StatusOK {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	reply(w, estimate)
}
