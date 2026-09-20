package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	orderdomain "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/order"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type OrderServer struct {
	auth    *auth.ServiceToken
	service *orderdomain.Service
}

func NewOrder(identityClient *identityintegration.Client, accessToken string, db *sql.DB, payment *wlt.Client) (*OrderServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	service, err := orderdomain.New(identityClient, db, payment)
	if err != nil {
		return nil, err
	}
	return &OrderServer{auth: authorizer, service: service}, nil
}

func (s *OrderServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/orders", s.listClient)
	mux.HandleFunc("GET /dsh/orders/{orderId}", s.read)
	mux.HandleFunc("GET /dsh/orders/{orderId}/tracking", s.readTracking)
	mux.HandleFunc("POST /dsh/orders/{orderId}/cancel", s.cancel)
	mux.HandleFunc("GET /dsh/operator/operations", s.listOperatorOperations)
	mux.HandleFunc("GET /dsh/operator/operations/{orderId}", s.readOperatorOperation)
	mux.HandleFunc("GET /dsh/stores/{storeId}/orders", s.listStore)
	mux.HandleFunc("GET /dsh/stores/{storeId}/orders/{orderId}", s.readStore)
	mux.HandleFunc("POST /dsh/stores/{storeId}/orders/{orderId}/transition", s.transition)
}

func (s *OrderServer) listOperatorOperations(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	limit, ok := orderLimit(w, r)
	if !ok {
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state != "" && !validOperatorOrderState(state) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "state is invalid")
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 512 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
		return
	}
	operations, err := s.service.ListForOperator(r.Context(), state, actingActorID, limit, cursor)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	items := make([]contract.OperatorOperation, 0, len(operations.Operations))
	for _, operation := range operations.Operations {
		items = append(items, toOperatorOperation(operation))
	}
	writeJSON(w, http.StatusOK, contract.OperatorOperationsResponse{Operations: items, NextCursor: operations.NextCursor})
}

func (s *OrderServer) readOperatorOperation(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	orderID := strings.TrimSpace(r.PathValue("orderId"))
	if actingActorID == "" || len(actingActorID) > 128 || orderID == "" || len(orderID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "operator actor and orderId are required")
		return
	}
	operation, err := s.service.ReadForOperator(r.Context(), orderID, actingActorID)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OperatorOperationResponse{Operation: toOperatorOperation(operation)})
}

func toOperatorOperation(operation postgres.OperatorOperationRecord) contract.OperatorOperation {
	var assignment *contract.OperatorAssignmentSummary
	if operation.Assignment != nil {
		assignment = &contract.OperatorAssignmentSummary{
			ID:             operation.Assignment.ID,
			OrderID:        operation.Assignment.OrderID,
			CaptainActorID: operation.Assignment.CaptainActorID,
			State:          operation.Assignment.State,
			Version:        operation.Assignment.Version,
			HandoffState:   operation.Assignment.Handoff.State,
		}
	}
	return contract.OperatorOperation{Order: toOrder(operation.Order), StoreName: operation.StoreName, Assignment: assignment}
}

func (s *OrderServer) listClient(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	limit, ok := orderLimit(w, r)
	if !ok {
		return
	}
	items, err := s.service.ListForClient(r.Context(), bearerToken(r), limit)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderListResponse{Orders: toOrders(items)})
}

func (s *OrderServer) read(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an active client or partner session is required")
		return
	}
	item, err := s.service.Read(r.Context(), bearerToken(r), r.PathValue("orderId"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderResponse{Order: toOrder(item)})
}

func (s *OrderServer) readTracking(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	tracking, err := s.service.ReadTracking(r.Context(), bearerToken(r), r.PathValue("orderId"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	response := contract.OrderTrackingResponse{OrderID: tracking.OrderID, OrderState: contract.OrderState(tracking.OrderState), TrackingState: contract.OrderTrackingState(tracking.TrackingState)}
	if tracking.AssignmentID != nil {
		assignmentID := *tracking.AssignmentID
		response.AssignmentID = &assignmentID
	}
	if tracking.CaptainLocation != nil {
		location := toCaptainLocationSnapshot(*tracking.CaptainLocation)
		response.CaptainLocation = &location
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *OrderServer) cancel(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cancellation attribution, idempotency, and a positive expected version are required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cancellation ownership comes from the canonical client session")
		return
	}
	item, replayed, err := s.service.CancelForClient(r.Context(), bearerToken(r), r.PathValue("orderId"), expected, idempotency, correlation)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.OrderResponse{Order: toOrder(item), IdempotentReplay: replayed})
}

func (s *OrderServer) listStore(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	storeID := strings.TrimSpace(r.PathValue("storeId"))
	if storeID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId is required")
		return
	}
	limit, ok := orderLimit(w, r)
	if !ok {
		return
	}
	items, err := s.service.ListForPartner(r.Context(), bearerToken(r), storeID, limit)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderListResponse{Orders: toOrders(items)})
}

func (s *OrderServer) readStore(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	item, err := s.service.Read(r.Context(), bearerToken(r), r.PathValue("orderId"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	if item.StoreID != strings.TrimSpace(r.PathValue("storeId")) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "partner Store ownership is required")
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderResponse{Order: toOrder(item)})
}

func (s *OrderServer) transition(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "transition attribution, idempotency, and a positive expected version are required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "transition ownership comes from the canonical partner session")
		return
	}
	var input contract.OrderTransitionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	state := strings.TrimSpace(input.State)
	if state != "PARTNER_ACCEPTED" && state != "PREPARING" && state != "READY_FOR_DISPATCH" && state != "REJECTED" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "order transition state is invalid")
		return
	}
	item, replayed, err := s.service.TransitionForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("orderId"), state, expected, idempotency, correlation)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderResponse{Order: toOrder(item), IdempotentReplay: replayed})
}

func orderLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "limit must be between 1 and 100")
			return 0, false
		}
		limit = parsed
	}
	return limit, true
}

func validOperatorOrderState(state string) bool {
	switch state {
	case "CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "CAPTAIN_ASSIGNED", "IN_CUSTODY", "DELIVERED", "DELIVERY_FAILED", "REJECTED", "CANCELLED":
		return true
	default:
		return false
	}
}

func toOrders(items []postgres.OrderRecord) []contract.Order {
	values := make([]contract.Order, 0, len(items))
	for _, item := range items {
		values = append(values, toOrder(item))
	}
	return values
}

func toOrder(item postgres.OrderRecord) contract.Order {
	lines := make([]contract.OrderLine, 0, len(item.Lines))
	for _, line := range item.Lines {
		finalQuantity := 0
		if line.FinalQuantityBaseUnits != nil {
			finalQuantity = int(*line.FinalQuantityBaseUnits)
		}
		modifierSnapshots := make([]contract.OrderLineModifierSnapshot, 0, len(line.ModifierSnapshots))
		for _, snapshot := range line.ModifierSnapshots {
			modifierSnapshots = append(modifierSnapshots, contract.OrderLineModifierSnapshot{OptionID: snapshot.OptionID, OptionNameAr: snapshot.OptionNameAr, PriceDeltaMinor: int(snapshot.PriceDeltaMinor)})
		}
		attributeSnapshots := make([]contract.OrderLineAttributeSnapshot, 0, len(line.AttributeSnapshots))
		for _, snapshot := range line.AttributeSnapshots {
			attributeSnapshots = append(attributeSnapshots, contract.OrderLineAttributeSnapshot{AttributeID: snapshot.AttributeID, Code: snapshot.Code, ValueKind: snapshot.ValueKind, TextValue: snapshotStringValue(snapshot.TextValue), IntegerValue: snapshotIntValue(snapshot.IntegerValue), DecimalValue: snapshotStringValue(snapshot.DecimalValue), BooleanValue: snapshotBoolValue(snapshot.BooleanValue), EnumValue: snapshotStringValue(snapshot.EnumValue), DateValue: snapshotStringValue(snapshot.DateValue), MeasurementUnit: snapshotStringValue(snapshot.MeasurementUnit)})
		}
		lines = append(lines, contract.OrderLine{ID: line.ID, OrderID: line.OrderID, StoreOfferID: line.StoreOfferID, VariantID: line.VariantID, ProductID: line.ProductID, ProductName: line.ProductName, VariantTitle: line.VariantTitle, MeasurementKind: contract.MeasurementKind(line.MeasurementKind), BaseUnit: contract.BaseUnit(line.BaseUnit), PricingBasis: line.PricingBasis, QuantityPolicy: line.QuantityPolicy, QuantityMinBaseUnits: int(line.QuantityMinBaseUnits), QuantityMaxBaseUnits: int(line.QuantityMaxBaseUnits), QuantityStepBaseUnits: int(line.QuantityStepBaseUnits), PricingUnitBaseUnits: int(line.PricingUnitBaseUnits), RequestedQuantityBaseUnits: int(line.RequestedQuantityBaseUnits), FinalQuantityBaseUnits: finalQuantity, ModifierAmountMinor: int(line.ModifierAmountMinor), UnitPriceMinor: int(line.UnitPriceMinor), LineAmountMinor: int(line.LineAmountMinor), Currency: line.Currency, SelectedModifierOptionIds: line.SelectedModifierOptionIDs, ModifierSnapshots: modifierSnapshots, AttributeSnapshots: attributeSnapshots, CreatedAt: line.CreatedAt})
	}
	paymentIntentID := ""
	if item.PaymentIntentID != nil {
		paymentIntentID = *item.PaymentIntentID
	}
	return contract.Order{ID: item.ID, ClientActorID: item.ClientActorID, StoreID: item.StoreID, CartID: item.CartID, AddressID: item.AddressID, AddressVersion: item.AddressVersion, AddressText: item.AddressText, AddressLatitude: item.AddressLatitude, AddressLongitude: item.AddressLongitude, ServiceCityID: item.ServiceCityID, ServiceabilityPolicyVersion: item.ServiceabilityPolicyVersion, ServiceabilityStatus: item.ServiceabilityStatus, ServiceabilityStoreVersion: item.ServiceabilityStoreVersion, ServiceabilityAddressVersion: item.ServiceabilityAddressVersion, State: contract.OrderState(item.State), TotalAmountMinor: int(item.TotalAmountMinor), Currency: item.Currency, PaymentMethod: contract.PaymentMethod(item.PaymentMethod), PaymentState: contract.PaymentState(item.PaymentState), PaymentIntentID: paymentIntentID, Version: item.Version, Lines: lines, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func snapshotStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func snapshotIntValue(value *int64) int {
	if value == nil {
		return 0
	}
	return int(*value)
}

func snapshotBoolValue(value *bool) bool {
	if value == nil {
		return false
	}
	return *value
}

func writeOrderError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrOperatorOperationInvalidCursor), errors.Is(err, postgres.ErrOperatorOperationInvalidLimit):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "operator operations pagination is invalid")
	case errors.Is(err, orderdomain.ErrClientSessionForbidden), errors.Is(err, orderdomain.ErrPartnerSessionForbidden), errors.Is(err, orderdomain.ErrStoreOwnershipForbidden), errors.Is(err, orderdomain.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the authenticated session is not permitted for this Order")
	case errors.Is(err, postgres.ErrOrderNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "order was not found")
	case errors.Is(err, postgres.ErrCheckoutEvidenceStale), errors.Is(err, postgres.ErrOrderVersionConflict), errors.Is(err, postgres.ErrOrderStateConflict):
		writeError(w, http.StatusConflict, "VERSION_OR_STATE_CONFLICT", "Order evidence, version, or lifecycle state is stale")
	case errors.Is(err, postgres.ErrPaymentStateConflict):
		writeError(w, http.StatusConflict, "PAYMENT_STATE_CONFLICT", "the order payment state is not actionable")
	case errors.Is(err, orderdomain.ErrPaymentUnavailable):
		writeError(w, http.StatusBadGateway, "WLT_PAYMENT_UNAVAILABLE", "the payment service is temporarily unavailable")
	case errors.Is(err, postgres.ErrOrderTransitionConflict), errors.Is(err, postgres.ErrCheckoutIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different Order facts")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}
