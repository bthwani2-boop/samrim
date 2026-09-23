package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

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

func (s *OrderServer) Service() *orderdomain.Service { return s.service }

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
	mux.HandleFunc("GET /dsh/orders/{orderId}/conversation", s.readConversation)
	mux.HandleFunc("POST /dsh/orders/{orderId}/conversation/messages", s.sendConversationMessage)
	mux.HandleFunc("POST /dsh/orders/{orderId}/conversation/read", s.markConversationRead)
	mux.HandleFunc("GET /dsh/orders/{orderId}/delivery-proof", s.readDeliveryProof)
	mux.HandleFunc("GET /dsh/orders/{orderId}/rating", s.readRating)
	mux.HandleFunc("POST /dsh/orders/{orderId}/rating", s.createRating)
	mux.HandleFunc("GET /dsh/orders/{orderId}/tracking", s.readTracking)
	mux.HandleFunc("POST /dsh/orders/{orderId}/cancel", s.cancel)
	mux.HandleFunc("GET /dsh/operator/operations", s.listOperatorOperations)
	mux.HandleFunc("GET /dsh/operator/operations/{orderId}", s.readOperatorOperation)
	mux.HandleFunc("GET /dsh/operator/cash-custody", s.listOperatorCashCustody)
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

func (s *OrderServer) listOperatorCashCustody(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actingActorID == "" || len(actingActorID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	result, err := s.service.ListCashCustodyForOperator(r.Context(), actingActorID)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	items := make([]contract.CashLiabilityItem, 0, len(result.Items))
	for _, item := range result.Items {
		collectedAt, parseErr := time.Parse(time.RFC3339Nano, item.CollectedAt)
		if parseErr != nil {
			writeError(w, http.StatusBadGateway, "WLT_CASH_UNAVAILABLE", "cash liability timestamp is invalid")
			return
		}
		items = append(items, contract.CashLiabilityItem{PaymentIntentID: item.PaymentIntentID, ExternalReference: item.ExternalReference, CaptainActorID: item.CaptainActorID, AmountMinor: int(item.AmountMinor), Currency: item.Currency, PaymentVersion: item.PaymentVersion, CollectedAt: collectedAt})
	}
	writeJSON(w, http.StatusOK, contract.CashLiabilityResponse{Items: items, TotalAmountMinor: int(result.TotalAmountMinor)})
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

func (s *OrderServer) readConversation(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an active Order conversation session is required")
		return
	}
	limit, ok := orderLimit(w, r)
	if !ok {
		return
	}
	conversation, err := s.service.ReadOrderConversation(r.Context(), token, r.PathValue("orderId"), limit)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	messages := make([]contract.OrderConversationMessage, 0, len(conversation.Messages))
	for _, message := range conversation.Messages {
		messages = append(messages, toOrderConversationMessage(message))
	}
	writeJSON(w, http.StatusOK, contract.OrderConversationResponse{OrderID: conversation.OrderID, OrderState: contract.OrderState(conversation.OrderState), ReadOnlyAt: conversation.ReadOnlyAt, CanSend: conversation.CanSend, Messages: messages, UnreadCount: conversation.UnreadCount})
}

func (s *OrderServer) sendConversationMessage(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an active Order conversation session is required")
		return
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "conversation attribution and idempotency are required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "conversation ownership comes from the canonical session")
		return
	}
	var input contract.CreateOrderConversationMessageRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if len([]rune(strings.TrimSpace(input.Body))) < 1 || len([]rune(strings.TrimSpace(input.Body))) > 2000 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "conversation body must contain between 1 and 2000 characters")
		return
	}
	message, replayed, err := s.service.SendOrderConversationMessage(r.Context(), token, r.PathValue("orderId"), input.Body, idempotency, correlation)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.OrderConversationMessageResponse{Message: toOrderConversationMessage(message), IdempotentReplay: replayed})
}

func (s *OrderServer) markConversationRead(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an active Order conversation session is required")
		return
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	if len(correlation) < 8 || len(correlation) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "conversation read attribution is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "conversation read ownership comes from the canonical session")
		return
	}
	var input contract.MarkOrderConversationReadRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	messageID := strings.TrimSpace(input.MessageID)
	if messageID == "" || len(messageID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "messageId is required")
		return
	}
	readAt, err := s.service.MarkOrderConversationRead(r.Context(), token, r.PathValue("orderId"), messageID)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderConversationReadResponse{OrderID: strings.TrimSpace(r.PathValue("orderId")), MessageID: messageID, ReadAt: readAt})
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

func (s *OrderServer) readDeliveryProof(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	proof, err := s.service.ReadClientDeliveryProof(r.Context(), bearerToken(r), r.PathValue("orderId"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	response := contract.DeliveryProofResponse{OrderID: proof.OrderID, ProofType: proof.ProofType, State: proof.State, VerifiedAt: proof.VerifiedAt}
	response.Code = proof.Code
	writeJSON(w, http.StatusOK, response)
}

func (s *OrderServer) readRating(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	rating, err := s.service.ReadClientOrderRating(r.Context(), bearerToken(r), r.PathValue("orderId"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderRatingResponse{Rating: toOrderRating(rating), IdempotentReplay: false})
}

func (s *OrderServer) createRating(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	var input contract.CreateOrderRatingRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expected < 1 || input.Rating < 1 || input.Rating > 5 || len([]rune(strings.TrimSpace(input.Review))) > 1000 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "rating, review, attribution, idempotency, and a positive expected version are required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "rating ownership comes from the canonical client session")
		return
	}
	rating, replayed, err := s.service.CreateClientOrderRating(r.Context(), bearerToken(r), r.PathValue("orderId"), input.Rating, input.Review, expected, idempotency, correlation)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.OrderRatingResponse{Rating: toOrderRating(rating), IdempotentReplay: replayed})
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
	var item postgres.OrderRecord
	var replayed bool
	if state == "PICKED_UP" {
		code := strings.TrimSpace(input.Code)
		if len(code) != 6 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "six-digit store pickup code is required")
			return
		}
		item, replayed, err = s.service.CompleteStorePickupForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("orderId"), code, expected, idempotency, correlation)
	} else {
		if state != "PARTNER_ACCEPTED" && state != "PREPARING" && state != "READY_FOR_DISPATCH" && state != "READY_FOR_PICKUP" && state != "REJECTED" && state != "CANCELLED" || strings.TrimSpace(input.Code) != "" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "order transition state or code is invalid")
			return
		}
		item, replayed, err = s.service.TransitionForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("orderId"), state, expected, idempotency, correlation)
	}
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
	case "CREATED", "PARTNER_ACCEPTED", "PREPARING", "READY_FOR_DISPATCH", "READY_FOR_PICKUP", "PICKED_UP", "CAPTAIN_ASSIGNED", "IN_CUSTODY", "DELIVERED", "DELIVERY_FAILED", "REJECTED", "CANCELLED":
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
	var pickupLocation *contract.OrderPickupLocation
	if item.PickupLocation != nil {
		pickupLocation = &contract.OrderPickupLocation{Latitude: item.PickupLocation.Latitude, Longitude: item.PickupLocation.Longitude}
	}
	return contract.Order{ID: item.ID, ClientActorID: item.ClientActorID, StoreID: item.StoreID, StoreName: item.StoreName, PickupLocation: pickupLocation, CartID: item.CartID, FulfillmentMode: contract.FulfillmentMode(item.FulfillmentMode), AddressID: item.AddressID, AddressVersion: item.AddressVersion, AddressText: item.AddressText, AddressLatitude: item.AddressLatitude, AddressLongitude: item.AddressLongitude, ServiceCityID: item.ServiceCityID, ServiceabilityPolicyVersion: item.ServiceabilityPolicyVersion, ServiceabilityStatus: item.ServiceabilityStatus, ServiceabilityStoreVersion: item.ServiceabilityStoreVersion, ServiceabilityAddressVersion: item.ServiceabilityAddressVersion, State: contract.OrderState(item.State), SubtotalAmountMinor: int(item.SubtotalAmountMinor), DiscountMinor: int(item.DiscountMinor), PromotionID: item.PromotionID, PromotionCode: item.PromotionCode, TotalAmountMinor: int(item.TotalAmountMinor), Currency: item.Currency, PaymentMethod: contract.PaymentMethod(item.PaymentMethod), PaymentState: contract.PaymentState(item.PaymentState), PaymentIntentID: paymentIntentID, Version: item.Version, Lines: lines, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func toOrderRating(item postgres.OrderRatingRecord) contract.OrderRating {
	return contract.OrderRating{OrderID: item.OrderID, StoreID: item.StoreID, Rating: item.Rating, Review: item.Review, CreatedAt: item.CreatedAt}
}

func toOrderConversationMessage(item postgres.OrderConversationMessageRecord) contract.OrderConversationMessage {
	return contract.OrderConversationMessage{ID: item.ID, OrderID: item.OrderID, SenderRole: item.SenderRole, Body: item.Body, CreatedAt: item.CreatedAt, ReadAt: item.ReadAt, Mine: item.Mine}
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
	case errors.Is(err, postgres.ErrOrderConversationNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "order conversation was not found")
	case errors.Is(err, postgres.ErrOrderRatingNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "order rating was not found")
	case errors.Is(err, postgres.ErrOrderRatingInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "order rating input is invalid")
	case errors.Is(err, postgres.ErrOrderRatingNotEligible):
		writeError(w, http.StatusConflict, "ORDER_RATING_NOT_ELIGIBLE", "an order can be rated only after delivery")
	case errors.Is(err, postgres.ErrOrderRatingAlreadyExists):
		writeError(w, http.StatusConflict, "ORDER_RATING_EXISTS", "this order already has a rating")
	case errors.Is(err, postgres.ErrOrderRatingIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different rating facts")
	case errors.Is(err, postgres.ErrOrderConversationInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "order conversation input is invalid")
	case errors.Is(err, postgres.ErrOrderConversationForbidden), errors.Is(err, orderdomain.ErrConversationSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the authenticated actor is not a participant in this Order conversation")
	case errors.Is(err, postgres.ErrOrderConversationMessageNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "order conversation message was not found")
	case errors.Is(err, postgres.ErrOrderConversationReadOnly):
		writeError(w, http.StatusConflict, "ORDER_CONVERSATION_READ_ONLY", "this Order conversation is read-only")
	case errors.Is(err, postgres.ErrOrderConversationIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different conversation facts")
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
