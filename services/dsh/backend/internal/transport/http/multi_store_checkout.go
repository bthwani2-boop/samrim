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
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/multistore"
	orderdomain "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/order"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type MultiStoreCheckoutServer struct{ service *multistore.Service }

func NewMultiStoreCheckout(identityClient *identityintegration.Client, db *sql.DB, cartService *cart.Service, orderService *orderdomain.Service) (*MultiStoreCheckoutServer, error) {
	service, err := multistore.New(identityClient, db, cartService, orderService)
	if err != nil {
		return nil, err
	}
	return &MultiStoreCheckoutServer{service: service}, nil
}

func (s *MultiStoreCheckoutServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/multi-store-checkouts", s.create)
	mux.HandleFunc("GET /dsh/multi-store-checkouts/{checkoutId}", s.read)
	mux.HandleFunc("POST /dsh/multi-store-checkouts/{checkoutId}/cancel", s.cancel)
}

func (s *MultiStoreCheckoutServer) create(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, _, ok := requiredMultiStoreMutationHeaders(w, r, false)
	if !ok {
		return
	}
	var input contract.MultiStoreCheckoutRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.ID) == "" || len(input.Children) < 2 || len(input.Children) > 10 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "id and between two and ten child carts are required")
		return
	}
	children := make([]postgres.MultiStoreCheckoutChildInput, 0, len(input.Children))
	for _, child := range input.Children {
		children = append(children, postgres.MultiStoreCheckoutChildInput{CartID: strings.TrimSpace(child.CartID), StoreID: strings.TrimSpace(child.StoreID), AddressID: strings.TrimSpace(child.AddressID), CartVersion: child.CartVersion, FulfillmentMode: string(child.FulfillmentMode), PromotionCode: strings.TrimSpace(child.PromotionCode)})
	}
	item, replayed, err := s.service.Checkout(r.Context(), bearerToken(r), postgres.MultiStoreCheckoutInput{ID: strings.TrimSpace(input.ID), Children: children}, idempotency, correlation)
	if err != nil {
		writeMultiStoreCheckoutError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.MultiStoreCheckoutResponse{Checkout: toMultiStoreCheckout(item), IdempotentReplay: replayed})
}

func (s *MultiStoreCheckoutServer) read(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	item, err := s.service.Read(r.Context(), bearerToken(r), r.PathValue("checkoutId"))
	if err != nil {
		writeMultiStoreCheckoutError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.MultiStoreCheckoutResponse{Checkout: toMultiStoreCheckout(item), IdempotentReplay: false})
}

func (s *MultiStoreCheckoutServer) cancel(w http.ResponseWriter, r *http.Request) {
	correlation, idempotency, expected, ok := requiredMultiStoreMutationHeaders(w, r, true)
	if !ok {
		return
	}
	item, replayed, err := s.service.Cancel(r.Context(), bearerToken(r), r.PathValue("checkoutId"), expected, idempotency, correlation)
	if err != nil {
		writeMultiStoreCheckoutError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.MultiStoreCheckoutResponse{Checkout: toMultiStoreCheckout(item), IdempotentReplay: replayed})
}

func requiredMultiStoreMutationHeaders(w http.ResponseWriter, r *http.Request, expectedRequired bool) (string, string, int, bool) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return "", "", 0, false
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "checkout ownership comes from the canonical client session")
		return "", "", 0, false
	}
	correlation, idempotency := strings.TrimSpace(r.Header.Get("X-Correlation-ID")), strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "checkout attribution and idempotency are required")
		return "", "", 0, false
	}
	if !expectedRequired {
		return correlation, idempotency, 0, true
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a positive expected checkout version is required")
		return "", "", 0, false
	}
	return correlation, idempotency, expected, true
}

func toMultiStoreCheckout(item postgres.MultiStoreCheckoutRecord) contract.MultiStoreCheckout {
	children := make([]contract.MultiStoreCheckoutChild, 0, len(item.Children))
	for _, child := range item.Children {
		children = append(children, contract.MultiStoreCheckoutChild{ID: child.ID, ChildIndex: child.ChildIndex, CartID: child.CartID, StoreID: child.StoreID, AddressID: child.AddressID, CartVersion: child.CartVersion, FulfillmentMode: contract.FulfillmentMode(child.FulfillmentMode), PromotionCode: child.PromotionCode, OrderID: child.OrderID, State: contract.MultiStoreCheckoutChildState(child.State), FailureCode: child.FailureCode, FailureMessage: child.FailureMessage, Version: child.Version, CreatedAt: child.CreatedAt, UpdatedAt: child.UpdatedAt})
	}
	return contract.MultiStoreCheckout{ID: item.ID, ClientActorID: item.ClientActorID, State: contract.MultiStoreCheckoutState(item.State), Version: item.Version, ChildCount: item.ChildCount, SuccessfulChildCount: item.SuccessfulChildCount, FailedChildCount: item.FailedChildCount, Children: children, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func writeMultiStoreCheckoutError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, multistore.ErrClientSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-client session is required")
	case errors.Is(err, multistore.ErrCheckoutInProgress):
		writeError(w, http.StatusConflict, "CHECKOUT_IN_PROGRESS", "the multi-store checkout is still processing")
	case errors.Is(err, postgres.ErrMultiStoreCheckoutNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "multi-store checkout was not found")
	case errors.Is(err, postgres.ErrMultiStoreCheckoutInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "multi-store checkout input is invalid")
	case errors.Is(err, postgres.ErrMultiStoreCheckoutIdempotencyConflict), errors.Is(err, postgres.ErrMultiStoreCheckoutVersionConflict), errors.Is(err, postgres.ErrMultiStoreCheckoutChildConflict):
		writeError(w, http.StatusConflict, "CHECKOUT_CONFLICT", "the multi-store checkout facts or version are stale")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence, Identity, or child checkout is unavailable")
	}
}
