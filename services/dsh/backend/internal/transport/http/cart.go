package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/cart"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/serviceability"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type CartServer struct{ service *cart.Service }

func NewCart(identityClient *identityintegration.Client, db *sql.DB, serviceabilityService *serviceability.Service, payment *wlt.Client) (*CartServer, error) {
	service, err := cart.New(identityClient, db, serviceabilityService, payment)
	if err != nil {
		return nil, err
	}
	return &CartServer{service: service}, nil
}

func (s *CartServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/cart", s.read)
	mux.HandleFunc("POST /dsh/cart/lines", s.upsertLine)
	mux.HandleFunc("PATCH /dsh/cart/lines/{lineId}", s.updateLine)
	mux.HandleFunc("DELETE /dsh/cart/lines/{lineId}", s.removeLine)
	mux.HandleFunc("POST /dsh/cart/checkout", s.checkout)
}

func (s *CartServer) read(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeCartError(w, cart.ErrClientSessionForbidden)
		return
	}
	storeID := strings.TrimSpace(r.URL.Query().Get("storeId"))
	if storeID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId is required")
		return
	}
	result, err := s.service.Read(r.Context(), bearerToken(r), storeID)
	if err != nil {
		writeCartError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CartResponse{Cart: toCart(result)})
}

func (s *CartServer) upsertLine(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredCartHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.UpsertCartLineRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	storeID := strings.TrimSpace(input.StoreID)
	if storeID == "" || strings.TrimSpace(input.StoreOfferID) == "" || input.QuantityBaseUnits < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId, storeOfferId and a positive quantity are required")
		return
	}
	result, replayed, err := s.service.UpsertLine(r.Context(), bearerToken(r), storeID, input.StoreOfferID, int64(input.QuantityBaseUnits), input.SelectedModifierOptionIds, expected, idempotency, correlation)
	if err != nil {
		writeCartError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.CartResponse{Cart: toCart(result), IdempotentReplay: replayed})
}

func (s *CartServer) updateLine(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredCartHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.UpdateCartLineRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.QuantityBaseUnits < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a positive quantity is required")
		return
	}
	result, replayed, err := s.service.UpdateLine(r.Context(), bearerToken(r), r.PathValue("lineId"), int64(input.QuantityBaseUnits), input.SelectedModifierOptionIds, expected, idempotency, correlation)
	if err != nil {
		writeCartError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.CartResponse{Cart: toCart(result), IdempotentReplay: replayed})
}

func (s *CartServer) removeLine(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredCartHeaders(w, r, false)
	if !ok {
		return
	}
	result, replayed, err := s.service.RemoveLine(r.Context(), bearerToken(r), r.PathValue("lineId"), expected, idempotency, correlation)
	if err != nil {
		writeCartError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.CartResponse{Cart: toCart(result), IdempotentReplay: replayed})
}

func (s *CartServer) checkout(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredCartHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.CheckoutRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.CartID) == "" || strings.TrimSpace(input.StoreID) == "" || strings.TrimSpace(input.AddressID) == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cartId, storeId and addressId are required")
		return
	}
	result, replayed, err := s.service.Checkout(r.Context(), bearerToken(r), input.CartID, input.StoreID, input.AddressID, expected, idempotency, correlation)
	if err != nil {
		writeCartError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.OrderResponse{Order: toOrder(result), IdempotentReplay: replayed})
}

func requiredCartHeaders(w http.ResponseWriter, r *http.Request, allowZero bool) (string, string, int, bool) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return "", "", 0, false
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cart ownership comes from the canonical client session")
		return "", "", 0, false
	}
	correlation, idempotency := strings.TrimSpace(r.Header.Get("X-Correlation-ID")), strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	minimum := 1
	if allowZero {
		minimum = 0
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expected < minimum {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cart mutation attribution, idempotency, and expected version are required")
		return "", "", 0, false
	}
	return correlation, idempotency, expected, true
}

func toCart(item postgres.CartRecord) contract.Cart {
	lines := make([]contract.CartLine, 0, len(item.Lines))
	for _, line := range item.Lines {
		modifiers := make([]contract.CartLineModifier, 0, len(line.SelectedModifiers))
		for _, modifier := range line.SelectedModifiers {
			modifiers = append(modifiers, contract.CartLineModifier{OptionID: modifier.OptionID, OptionNameAr: modifier.OptionNameAr, PriceDeltaMinor: int(modifier.PriceDeltaMinor)})
		}
		lines = append(lines, contract.CartLine{ID: line.ID, CartID: line.CartID, StoreOfferID: line.StoreOfferID, VariantID: line.VariantID, ProductID: line.ProductID, ProductName: line.ProductName, VariantTitle: line.VariantTitle, MeasurementKind: contract.MeasurementKind(line.MeasurementKind), BaseUnit: contract.BaseUnit(line.BaseUnit), PricingBasis: line.PricingBasis, QuantityPolicy: line.QuantityPolicy, QuantityMinBaseUnits: int(line.QuantityMinBaseUnits), QuantityMaxBaseUnits: int(line.QuantityMaxBaseUnits), QuantityStepBaseUnits: int(line.QuantityStepBaseUnits), PricingUnitBaseUnits: int(line.PricingUnitBaseUnits), QuantityBaseUnits: int(line.QuantityBaseUnits), SelectedModifierOptionIds: line.SelectedModifierOptionIDs, SelectedModifiers: modifiers, UnitPriceMinor: int(line.UnitPriceMinor), ModifierAmountMinor: int(line.ModifierAmountMinor), LineAmountMinor: int(line.LineAmountMinor), Currency: line.Currency, OfferVersion: line.OfferVersion, CreatedAt: line.CreatedAt, UpdatedAt: line.UpdatedAt})
	}
	return contract.Cart{ID: item.ID, StoreID: item.StoreID, State: contract.CartState(item.State), Version: item.Version, Lines: lines, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func writeCartError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, cart.ErrClientSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-client session is required")
	case errors.Is(err, postgres.ErrCartNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "cart was not found")
	case errors.Is(err, postgres.ErrCartVersionConflict), errors.Is(err, postgres.ErrCheckoutEvidenceStale):
		writeError(w, http.StatusConflict, "STALE_CHECKOUT", "cart, offer, address, or serviceability evidence is stale")
	case errors.Is(err, postgres.ErrCartIdempotencyConflict), errors.Is(err, postgres.ErrCheckoutIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different cart or checkout facts")
	case errors.Is(err, postgres.ErrCartOfferUnavailable):
		writeError(w, http.StatusConflict, "OFFER_UNAVAILABLE", "the StoreOffer is no longer customer-visible")
	case errors.Is(err, postgres.ErrCartEmpty):
		writeError(w, http.StatusConflict, "CART_EMPTY", "cart must contain at least one current line")
	case errors.Is(err, postgres.ErrCartQuantityInvalid), errors.Is(err, postgres.ErrCartModifierInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cart quantity or modifier selection is invalid")
	case errors.Is(err, postgres.ErrCartStateConflict):
		writeError(w, http.StatusConflict, "CART_CLOSED", "cart is no longer open")
	case errors.Is(err, postgres.ErrPaymentProvisioning):
		writeError(w, http.StatusBadGateway, "WLT_PAYMENT_UNAVAILABLE", "the payment service is temporarily unavailable; the order was not created")
	case errors.Is(err, cart.ErrCheckoutNotServiceable):
		writeError(w, http.StatusConflict, "UNSERVICEABLE", "the selected address is not serviceable for this Store")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence, Identity, or serviceability is unavailable")
	}
}
