package transporthttp

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

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

func NewOrder(identityClient *identityintegration.Client, accessToken string, db *sql.DB, payment *wlt.Client, proofKeys *postgres.DeliveryProofKeyring) (*OrderServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	service, err := orderdomain.New(identityClient, db, payment, proofKeys)
	if err != nil {
		return nil, err
	}
	return &OrderServer{auth: authorizer, service: service}, nil
}

func (s *OrderServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/orders", s.listClient)
	mux.HandleFunc("GET /dsh/orders/{orderId}", s.read)
	mux.HandleFunc("POST /dsh/orders/{orderId}/adjustments/{adjustmentId}/decision", s.decideClientOrderAdjustment)
	mux.HandleFunc("GET /dsh/orders/{orderId}/conversation", s.readConversation)
	mux.HandleFunc("POST /dsh/orders/{orderId}/conversation/messages", s.sendConversationMessage)
	mux.HandleFunc("GET /dsh/orders/{orderId}/conversation/messages/{messageId}/media", s.readConversationMedia)
	mux.HandleFunc("POST /dsh/orders/{orderId}/conversation/read", s.markConversationRead)
	mux.HandleFunc("GET /dsh/orders/{orderId}/delivery-proof", s.readDeliveryProof)
	mux.HandleFunc("GET /dsh/orders/{orderId}/rating", s.readRating)
	mux.HandleFunc("POST /dsh/orders/{orderId}/rating", s.createRating)
	mux.HandleFunc("POST /dsh/orders/{orderId}/cancel", s.cancel)
	mux.HandleFunc("POST /dsh/orders/{orderId}/cancellation-request", s.createClientCancellationRequest)
	mux.HandleFunc("GET /dsh/orders/{orderId}/cancellation-request", s.readClientCancellationRequest)
	mux.HandleFunc("GET /dsh/operator/cancellation-requests", s.listOperatorCancellationRequests)
	mux.HandleFunc("POST /dsh/operator/cancellation-requests/{requestId}/decline", s.declineOperatorCancellationRequest)
	mux.HandleFunc("POST /dsh/operator/operations/{orderId}/cancel", s.cancelForOperator)
	mux.HandleFunc("GET /dsh/operator/operations", s.listOperatorOperations)
	mux.HandleFunc("GET /dsh/operator/stage-sla-policies", s.readOperatorStageSLAPolicies)
	mux.HandleFunc("POST /dsh/operator/stage-sla-policies", s.createOperatorStageSLAPolicy)
	mux.HandleFunc("GET /dsh/operator/customer-contact-queue", s.listOperatorCustomerContactQueue)
	mux.HandleFunc("GET /dsh/operator/operational-cases", s.listOperatorCaseInbox)
	mux.HandleFunc("GET /dsh/operator/home-analytics", s.readOperatorHomeAnalytics)
	mux.HandleFunc("GET /dsh/operator/customers/{actorId}/orders", s.listOperatorCustomerOrders)
	mux.HandleFunc("GET /dsh/operator/operations/{orderId}", s.readOperatorOperation)
	mux.HandleFunc("GET /dsh/operator/operations/{orderId}/contact-review", s.readOperatorContactReview)
	mux.HandleFunc("GET /dsh/operator/operations/{orderId}/mission-location", s.readOperatorMissionLocation)
	mux.HandleFunc("GET /dsh/operator/operations/{orderId}/cases", s.listOperatorOrderCases)
	mux.HandleFunc("POST /dsh/operator/operations/{orderId}/cases", s.openOperatorOrderCase)
	mux.HandleFunc("POST /dsh/operator/operations/{orderId}/cases/{caseId}/transition", s.transitionOperatorOrderCase)
	mux.HandleFunc("GET /dsh/operator/operations/{orderId}/cases/{caseId}/events", s.listOperatorCaseEvents)
	mux.HandleFunc("GET /dsh/operator/operations/{orderId}/cases/{caseId}/resolution-evidence", s.listOperatorCaseResolutionEvidence)
	mux.HandleFunc("POST /dsh/operator/operations/{orderId}/contact-review", s.recordOperatorContactReview)
	mux.HandleFunc("POST /dsh/operator/operations/{orderId}/contact-review/claim", s.updateOperatorContactClaim)
	mux.HandleFunc("GET /dsh/operator/cash-custody", s.listOperatorCashCustody)
	mux.HandleFunc("POST /dsh/operator/cash-remittances/{remittanceId}/reconcile", s.reconcileOperatorCashRemittance)
	mux.HandleFunc("GET /dsh/stores/{storeId}/orders", s.listStore)
	mux.HandleFunc("GET /dsh/partner/orders", s.listPartnerOrders)
	mux.HandleFunc("GET /dsh/stores/{storeId}/orders/{orderId}", s.readStore)
	mux.HandleFunc("POST /dsh/stores/{storeId}/orders/{orderId}/adjustments", s.proposePartnerOrderAdjustment)
	mux.HandleFunc("POST /dsh/stores/{storeId}/orders/{orderId}/transition", s.transition)
	mux.HandleFunc("POST /dsh/stores/{storeId}/orders/{orderId}/captain-cash-handoff/confirm", s.confirmStoreCaptainCashHandoff)
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
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(query) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "q is too long")
		return
	}
	sort := strings.TrimSpace(r.URL.Query().Get("sort"))
	if sort != "" && sort != "updated_desc" && sort != "updated_asc" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "sort is invalid")
		return
	}
	actionableOnly := false
	if rawActionable := r.URL.Query().Get("actionableOnly"); rawActionable != "" {
		if rawActionable != "true" && rawActionable != "false" {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "actionableOnly must be true or false")
			return
		}
		actionableOnly = rawActionable == "true"
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 512 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
		return
	}
	storeID := strings.TrimSpace(r.URL.Query().Get("storeId"))
	if (r.URL.Query().Has("storeId") && storeID == "") || len(storeID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeId is invalid")
		return
	}
	var operations postgres.OperatorOperationsResult
	var err error
	if storeID != "" {
		operations, err = s.service.ListForOperatorStore(r.Context(), state, query, sort, actingActorID, actionableOnly, limit, cursor, storeID)
	} else {
		operations, err = s.service.ListForOperator(r.Context(), state, query, sort, actingActorID, actionableOnly, limit, cursor)
	}
	if err != nil {
		writeOrderError(w, err)
		return
	}
	items := make([]contract.OperatorOperationListItem, 0, len(operations.Operations))
	for _, operation := range operations.Operations {
		items = append(items, toOperatorOperationListItem(operation))
	}
	summary := operations.Summary
	writeJSON(w, http.StatusOK, contract.OperatorOperationsResponse{Operations: items, NextCursor: operations.NextCursor,
		Summary: contract.OperatorOperationsSummary{TotalCount: summary.TotalCount, ActionableCount: summary.ActionableCount,
			AwaitingDispatchCount: summary.AwaitingDispatchCount, ActiveCount: summary.ActiveCount, DeliveredCount: summary.DeliveredCount,
			InCustodyOrderCount: summary.InCustodyOrderCount, InCustodyOrderValueMinor: int(summary.InCustodyOrderValueMinor), MeasuredAt: summary.MeasuredAt}})
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
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if utf8.RuneCountInString(search) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "search is too long")
		return
	}
	sort := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort")))
	if sort == "" {
		sort = "collected_asc"
	}
	if sort != "collected_asc" && sort != "collected_desc" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "sort is invalid")
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 1024 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is too long")
		return
	}
	limit, ok := orderLimit(w, r)
	if !ok {
		return
	}
	result, err := s.service.ListCashCustodyForOperator(r.Context(), actingActorID, search, sort, cursor, limit)
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
		items = append(items, contract.CashLiabilityItem{PaymentIntentID: item.PaymentIntentID, ExternalReference: item.ExternalReference, CaptainActorID: item.CaptainActorID, AmountMinor: int(item.AmountMinor), Currency: item.Currency, PaymentVersion: item.PaymentVersion, CollectedAt: collectedAt, RemittanceState: item.RemittanceState, RemittanceReference: item.RemittanceReference, RemittanceID: item.RemittanceID})
	}
	writeJSON(w, http.StatusOK, contract.CashCustodyRegistryResponse{Items: items, TotalAmountMinor: int(result.TotalAmountMinor), TotalItems: result.TotalItems, Limit: result.Limit, NextCursor: result.NextCursor})
}

func (s *OrderServer) reconcileOperatorCashRemittance(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client actor authority headers are forbidden")
		return
	}
	actingActorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlationID := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if actingActorID == "" || len(actingActorID) > 128 || len(correlationID) < 8 || len(correlationID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Finance actor, X-Correlation-ID and Idempotency-Key are required")
		return
	}
	var input struct {
		EvidenceDocumentID string `json:"evidenceDocumentId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	remittance, replayed, err := s.service.ReconcileCashRemittance(r.Context(), actingActorID, r.PathValue("remittanceId"), input.EvidenceDocumentID, idempotencyKey, correlationID)
	if err != nil {
		var wltErr *wlt.Error
		if errors.As(err, &wltErr) {
			writeError(w, wltErr.Status, wltErr.Code, wltErr.Message)
			return
		}
		writeOrderError(w, err)
		return
	}
	createdAt, err := time.Parse(time.RFC3339Nano, remittance.CreatedAt)
	if err != nil {
		writeError(w, http.StatusBadGateway, "WLT_CASH_UNAVAILABLE", "cash remittance timestamp is invalid")
		return
	}
	response := contract.CaptainCashRemittance{ID: remittance.ID, PaymentIntentID: remittance.PaymentIntentID, CaptainActorID: remittance.CaptainActorID, AmountMinor: int(remittance.AmountMinor), Currency: remittance.Currency, RemittanceReference: remittance.RemittanceReference, State: remittance.State, CreatedAt: createdAt}
	if remittance.ReconciledBy != nil {
		response.ReconciledBy = *remittance.ReconciledBy
	}
	if remittance.ReconciledAt != nil {
		value, parseErr := time.Parse(time.RFC3339Nano, *remittance.ReconciledAt)
		if parseErr != nil {
			writeError(w, http.StatusBadGateway, "WLT_CASH_UNAVAILABLE", "cash reconciliation timestamp is invalid")
			return
		}
		response.ReconciledAt = &value
	}
	if remittance.ReceiptDocumentID != nil {
		response.ReceiptDocumentID = *remittance.ReceiptDocumentID
	}
	writeJSON(w, http.StatusOK, contract.CaptainCashRemittanceResponse{CashRemittance: response, IdempotentReplay: replayed})
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
	history := make([]contract.OperatorOperationEvent, 0, len(operation.History))
	for _, event := range operation.History {
		history = append(history, contract.OperatorOperationEvent{ID: event.ID, Source: event.Source, EventType: event.EventType, State: event.State, ActorID: event.ActorID, DecisionReason: event.Reason, At: event.At})
	}
	return contract.OperatorOperation{Order: toOrder(operation.Order), StoreName: operation.StoreName, Assignment: assignment, CustomerSuccessfulOrdersCount: operation.CustomerSuccessfulOrdersCount, SuccessfulOrderOrdinal: operation.SuccessfulOrderOrdinal, History: history, HistoryHasMore: operation.HistoryHasMore}
}

// The generated field is optional; 0 is omitted for stores without a target.
func optionalPreparationMinutes(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func toOperatorOperationListItem(operation postgres.OperatorOperationListRecord) contract.OperatorOperationListItem {
	var assignment *contract.OperatorAssignmentSummary
	if operation.Assignment != nil {
		assignment = &contract.OperatorAssignmentSummary{ID: operation.Assignment.ID, OrderID: operation.Assignment.OrderID, CaptainActorID: operation.Assignment.CaptainActorID, State: operation.Assignment.State, Version: operation.Assignment.Version, HandoffState: operation.Assignment.HandoffState}
	}
	return contract.OperatorOperationListItem{OrderID: operation.OrderID, StoreName: operation.StoreName, State: contract.OrderState(operation.State), UpdatedAt: operation.UpdatedAt, StageStartedAt: operation.StageStartedAt, PreparationMinutes: optionalPreparationMinutes(operation.PreparationMinutes), SlaStatus: operation.StageSLA.Status, SlaReason: operation.StageSLA.Reason, SlaDeadlineAt: operation.StageSLA.DeadlineAt, SlaPolicyVersion: operation.StageSLA.PolicyVersion, SlaTargetMinutes: operation.StageSLA.TargetMinutes, Assignment: assignment}
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
	cartID := strings.TrimSpace(r.URL.Query().Get("cartId"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cartID) > 128 || len(cursor) > 4096 || (cartID != "" && cursor != "") {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client Order filter or cursor is invalid")
		return
	}
	page, err := s.service.ListForClient(r.Context(), bearerToken(r), limit, cartID, cursor)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderListResponse{Orders: toOrders(page.Orders), NextCursor: page.NextCursor})
}

func (s *OrderServer) read(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an active client or partner session is required")
		return
	}
	item, role, err := s.service.Read(r.Context(), bearerToken(r), r.PathValue("orderId"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderResponse{Order: toOrderForRole(item, role)})
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
	conversation, err := s.service.ReadOrderConversation(r.Context(), token, r.PathValue("orderId"), limit, r.URL.Query().Get("before"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	messages := make([]contract.OrderConversationMessage, 0, len(conversation.Messages))
	for _, message := range conversation.Messages {
		messages = append(messages, toOrderConversationMessage(message))
	}
	writeJSON(w, http.StatusOK, contract.OrderConversationResponse{OrderID: conversation.OrderID, OrderState: contract.OrderState(conversation.OrderState), ReadOnlyAt: conversation.ReadOnlyAt, CanSend: conversation.CanSend, Messages: messages, UnreadCount: conversation.UnreadCount, NextCursor: conversation.NextCursor})
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
	r.Body = http.MaxBytesReader(w, r.Body, 9*1024*1024)
	var input contract.CreateOrderConversationMessageRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if len([]rune(strings.TrimSpace(input.Body))) < 1 || len([]rune(strings.TrimSpace(input.Body))) > 2000 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "conversation body must contain between 1 and 2000 characters")
		return
	}
	var message postgres.OrderConversationMessageRecord
	var replayed bool
	var err error
	if input.MediaKind != "" || input.MediaContentType != "" || input.MediaBase64 != "" {
		if input.MediaKind == "" || input.MediaContentType == "" || len(input.MediaBase64) > 8*1024*1024+128 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid private media input")
			return
		}
		payload, decodeErr := base64.StdEncoding.DecodeString(input.MediaBase64)
		if decodeErr != nil {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid media encoding")
			return
		}
		media := postgres.OrderConversationMedia{Kind: input.MediaKind, ContentType: input.MediaContentType, Bytes: payload}
		message, replayed, err = s.service.SendOrderConversationMedia(r.Context(), token, r.PathValue("orderId"), input.Body, idempotency, correlation, input.RecipientRoles, media)
	} else {
		message, replayed, err = s.service.SendOrderConversationMessage(r.Context(), token, r.PathValue("orderId"), input.Body, idempotency, correlation, input.RecipientRoles...)
	}
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

func (s *OrderServer) readConversationMedia(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "order session required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "conversation identity belongs to session")
		return
	}
	media, err := s.service.ReadOrderConversationMedia(r.Context(), token, r.PathValue("orderId"), r.PathValue("messageId"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	writeJSON(w, http.StatusOK, map[string]string{"mediaKind": media.Kind, "contentType": media.ContentType, "dataBase64": base64.StdEncoding.EncodeToString(media.Bytes)})
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

// The server checks the immutable Order policy under the same lock as the state transition.
func (s *OrderServer) cancel(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client identity comes from the session")
		return
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cancellation attribution, idempotency and expected version are required")
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

func (s *OrderServer) cancelForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client authority headers are forbidden")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if actor == "" || len(actor) > 128 || len(correlation) < 8 || len(correlation) > 128 ||
		len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "operator, version and audit headers are required")
		return
	}
	var input struct {
		Reason          string `json:"reason"`
		PartnerReviewed bool   `json:"partnerReviewed"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if count := utf8.RuneCountInString(strings.TrimSpace(input.Reason)); count < 12 || count > 500 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "reviewed cancellation reason must contain 12 to 500 characters")
		return
	}
	item, replayed, err := s.service.CancelForOperator(r.Context(), r.PathValue("orderId"),
		actor, input.Reason, input.PartnerReviewed, expected, idempotency, correlation)
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
	state, ok := orderStateFilter(w, r)
	if !ok {
		return
	}
	query, ok := orderSearchQuery(w, r)
	if !ok {
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 1024 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is invalid")
		return
	}
	page, err := s.service.ListForPartner(r.Context(), bearerToken(r), storeID, orderStateValues(state), query, limit, cursor)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderListResponse{Orders: toPartnerOrders(page.Orders), NextCursor: page.NextCursor})
}

// listPartnerOrders serves the aggregate Partner order read across the
// actor's server-authorized Store scope; requested storeIds only narrow that
// server-resolved scope.
func (s *OrderServer) listPartnerOrders(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	limit, ok := orderLimit(w, r)
	if !ok {
		return
	}
	state, ok := orderStateFilter(w, r)
	if !ok {
		return
	}
	query, ok := orderSearchQuery(w, r)
	if !ok {
		return
	}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if len(cursor) > 1024 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cursor is invalid")
		return
	}
	var requestedStoreIDs []string
	if raw := strings.TrimSpace(r.URL.Query().Get("storeIds")); raw != "" {
		requestedStoreIDs = strings.Split(raw, ",")
		if len(requestedStoreIDs) > 200 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "storeIds is invalid")
			return
		}
	}
	page, attention, err := s.service.ListForAuthorizedPartnerStores(r.Context(), bearerToken(r), requestedStoreIDs, orderStateValues(state), query, limit, cursor)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.PartnerOrdersResponse{
		Orders:     toPartnerOrders(page.Orders),
		NextCursor: page.NextCursor,
		Attention: contract.PartnerOrderAttentionCounts{
			NewOrders:        int(attention.NewOrders),
			AwaitingDispatch: int(attention.AwaitingDispatch),
			DeliveryRecovery: int(attention.DeliveryRecovery),
		},
	})
}

func orderStateFilter(w http.ResponseWriter, r *http.Request) (string, bool) {
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state == "" {
		return "", true
	}
	values := orderStateValues(state)
	if len(values) == 0 || len(values) > 7 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "state filter is not a canonical order state list")
		return "", false
	}
	for _, value := range values {
		if !validOperatorOrderState(value) {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "state filter is not a canonical order state")
			return "", false
		}
	}
	return state, true
}

func orderStateValues(state string) []string {
	if strings.TrimSpace(state) == "" {
		return nil
	}
	return strings.Split(state, ",")
}

func orderSearchQuery(w http.ResponseWriter, r *http.Request) (string, bool) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "search query must be at most 128 characters")
		return "", false
	}
	return query, true
}

func requirePartnerStoreOrderReadRole(w http.ResponseWriter, role string) bool {
	if role != "partner" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "partner session is required")
		return false
	}
	return true
}

func (s *OrderServer) readStore(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	item, role, err := s.service.Read(r.Context(), bearerToken(r), r.PathValue("orderId"))
	if err != nil {
		writeOrderError(w, err)
		return
	}
	if !requirePartnerStoreOrderReadRole(w, role) {
		return
	}
	if item.StoreID != strings.TrimSpace(r.PathValue("storeId")) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "partner Store ownership is required")
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderResponse{Order: redactPartnerOrder(toOrder(item))})
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
	writeJSON(w, http.StatusOK, contract.OrderResponse{Order: redactPartnerOrder(toOrder(item)), IdempotentReplay: replayed})
}

func (s *OrderServer) confirmStoreCaptainCashHandoff(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 || err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "handoff attribution, idempotency, and a positive expected version are required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("X-Acting-Actor-ID") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cash handoff ownership comes from the canonical partner session")
		return
	}
	item, replayed, err := s.service.ConfirmStoreCaptainCashHandoff(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("orderId"), expected, idempotency, correlation)
	if err != nil {
		writeOrderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.OrderResponse{Order: redactPartnerOrder(toOrder(item)), IdempotentReplay: replayed})
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

// The Partner surface needs order composition and payment facts, not the
// customer's private destination for BThwani-delivered or pickup orders.
func toOrderForRole(item postgres.OrderRecord, role string) contract.Order {
	order := toOrder(item)
	switch role {
	case "client":
		return order
	case "partner":
		return redactPartnerOrder(order)
	default:
		return contract.Order{}
	}
}
func redactPartnerOrder(value contract.Order) contract.Order {
	if value.FulfillmentMode != "PARTNER_CAPTAIN" {
		value.AddressID = ""
		value.AddressVersion = 0
		value.AddressText = ""
		value.AddressLatitude = 0
		value.AddressLongitude = 0
		value.ServiceabilityAddressVersion = 0
	}
	if value.FulfillmentMode == "BTHWANI_CAPTAIN" {
		value.Recipient = contract.OrderRecipient{Mode: value.Recipient.Mode}
	}
	return value
}

func toPartnerOrders(items []postgres.OrderRecord) []contract.Order {
	values := toOrders(items)
	for index := range values {
		values[index] = redactPartnerOrder(values[index])
	}
	return values
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
	adjustments := make([]contract.OrderAdjustment, 0, len(item.Adjustments))
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
	for _, adjustment := range item.Adjustments {
		quantity := 0
		if adjustment.ActualQuantityBaseUnits != nil {
			quantity = int(*adjustment.ActualQuantityBaseUnits)
		}
		adjustments = append(adjustments, contract.OrderAdjustment{ID: adjustment.ID, OrderID: adjustment.OrderID, OrderLineID: adjustment.OrderLineID, Kind: adjustment.Kind, State: adjustment.State, ActualQuantityBaseUnits: quantity, RequestedByActorID: adjustment.RequestedByActorID, RequestedByRole: adjustment.RequestedByRole, Version: adjustment.Version, CreatedAt: adjustment.CreatedAt, UpdatedAt: adjustment.UpdatedAt})
	}
	paymentIntentID := ""
	if item.PaymentIntentID != nil {
		paymentIntentID = *item.PaymentIntentID
	}
	var pickupLocation *contract.OrderPickupLocation
	if item.PickupLocation != nil {
		pickupLocation = &contract.OrderPickupLocation{Latitude: item.PickupLocation.Latitude, Longitude: item.PickupLocation.Longitude}
	}
	recipient := contract.OrderRecipient{Mode: item.Recipient.Mode}
	if item.Recipient.Name != nil {
		recipient.Name = *item.Recipient.Name
	}
	if item.Recipient.PhoneE164 != nil {
		recipient.PhoneE164 = *item.Recipient.PhoneE164
	}
	if item.Recipient.Instructions != nil {
		recipient.Instructions = *item.Recipient.Instructions
	}
	return contract.Order{ID: item.ID, ClientActorID: item.ClientActorID, StoreID: item.StoreID, CancellationMode: item.CancellationMode, CancellationPolicyVersion: item.CancellationPolicyVersion, StoreName: item.StoreName, PickupLocation: pickupLocation, CartID: item.CartID, CustomerNote: item.CustomerNote, FulfillmentMode: contract.FulfillmentMode(item.FulfillmentMode), AddressID: item.AddressID, AddressVersion: item.AddressVersion, AddressText: item.AddressText, AddressLatitude: item.AddressLatitude, AddressLongitude: item.AddressLongitude, ServiceCityID: item.ServiceCityID, ServiceabilityPolicyVersion: item.ServiceabilityPolicyVersion, ServiceabilityStatus: item.ServiceabilityStatus, ServiceabilityStoreVersion: item.ServiceabilityStoreVersion, ServiceabilityAddressVersion: item.ServiceabilityAddressVersion, Recipient: recipient, State: contract.OrderState(item.State), SubtotalAmountMinor: int(item.SubtotalAmountMinor), DiscountMinor: int(item.DiscountMinor), PromotionID: item.PromotionID, PromotionCode: item.PromotionCode, TotalAmountMinor: int(item.TotalAmountMinor), CashAmountMinor: int(item.PaymentCashAmountMinor), Currency: item.Currency, PaymentMethod: contract.PaymentMethod(item.PaymentMethod), PaymentState: contract.PaymentState(item.PaymentState), PaymentIntentID: paymentIntentID, StoreCashHandoffState: item.StoreCashHandoffState, Version: item.Version, Lines: lines, Adjustments: adjustments, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func toOrderRating(item postgres.OrderRatingRecord) contract.OrderRating {
	return contract.OrderRating{OrderID: item.OrderID, StoreID: item.StoreID, Rating: item.Rating, Review: item.Review, CreatedAt: item.CreatedAt}
}

func toOrderConversationMessage(item postgres.OrderConversationMessageRecord) contract.OrderConversationMessage {
	return contract.OrderConversationMessage{ID: item.ID, OrderID: item.OrderID, SenderRole: item.SenderRole, RecipientRoles: item.RecipientRoles, MediaKind: item.MediaKind, MediaContentType: item.MediaContentType, Body: item.Body, CreatedAt: item.CreatedAt, ReadAt: item.ReadAt, Mine: item.Mine}
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
	case errors.Is(err, postgres.ErrPartnerOrdersScopeInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partner orders Store scope is invalid")
	case errors.Is(err, postgres.ErrClientOrdersInvalidCursor), errors.Is(err, postgres.ErrOperatorCustomerOrdersInvalidCursor):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "customer Order history cursor is invalid")
	case errors.Is(err, postgres.ErrPartnerOrdersInvalidState), errors.Is(err, postgres.ErrPartnerOrdersInvalidQuery), errors.Is(err, postgres.ErrPartnerOrdersInvalidCursor), errors.Is(err, postgres.ErrOperatorOperationInvalidCursor), errors.Is(err, postgres.ErrOperatorOperationInvalidLimit):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partner or operator orders pagination, state, or search is invalid")
	case errors.Is(err, orderdomain.ErrClientSessionForbidden), errors.Is(err, orderdomain.ErrPartnerSessionForbidden), errors.Is(err, orderdomain.ErrStoreOwnershipForbidden), errors.Is(err, orderdomain.ErrOperatorNotActive):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the authenticated session is not permitted for this Order")
	case errors.Is(err, postgres.ErrOrderNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "order was not found")
	case errors.Is(err, postgres.ErrOrderConversationNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "order conversation was not found")
	case errors.Is(err, postgres.ErrOrderRatingNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "order rating was not found")
	case errors.Is(err, postgres.ErrOpsCaseInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "case input is invalid")
	case errors.Is(err, postgres.ErrOpsCaseConflict):
		writeError(w, http.StatusConflict, "CASE_CONFLICT", "case exists, changed or already resolved")
	case errors.Is(err, postgres.ErrOpsCaseIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "case key reused with different facts")
	case errors.Is(err, postgres.ErrOpsCaseForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only the assigned case owner may advance the case")
	case errors.Is(err, postgres.ErrOpsCaseUnverified):
		writeError(w, http.StatusConflict, "CASE_CLOSURE_UNVERIFIED", "the canonical settlement or goods proof is not confirmed")
	case errors.Is(err, postgres.ErrOpsCaseNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "case not found")
	case errors.Is(err, postgres.ErrCustomerContactInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "customer contact review input is invalid")
	case errors.Is(err, postgres.ErrCustomerContactConflict):
		writeError(w, http.StatusConflict, "CONTACT_REVIEW_STALE", "customer contact review changed or order is already complete")
	case errors.Is(err, postgres.ErrCustomerContactIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "contact Idempotency-Key was reused with different facts")
	case errors.Is(err, postgres.ErrOrderRatingInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "order rating input is invalid")
	case errors.Is(err, orderdomain.ErrCashRemittanceInputInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cash remittance reconciliation input is invalid")
	case errors.Is(err, postgres.ErrOrderRatingNotEligible):
		writeError(w, http.StatusConflict, "ORDER_RATING_NOT_ELIGIBLE", "an order can be rated only after delivery")
	case errors.Is(err, postgres.ErrOrderRatingAlreadyExists):
		writeError(w, http.StatusConflict, "ORDER_RATING_EXISTS", "this order already has a rating")
	case errors.Is(err, postgres.ErrOrderRatingIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different rating facts")
	case errors.Is(err, postgres.ErrOrderAdjustmentInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Order adjustment facts are invalid for the immutable Order line snapshot")
	case errors.Is(err, postgres.ErrOrderAdjustmentNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Order adjustment or line was not found")
	case errors.Is(err, postgres.ErrOrderAdjustmentIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different Order adjustment facts")
	case errors.Is(err, orderdomain.ErrOperatorCancellationReviewRequired):
		writeError(w, http.StatusConflict, "PARTNER_REVIEW_REQUIRED", "the partner must be reviewed before Operations cancels a preparing order")
	case errors.Is(err, postgres.ErrOrderTransitionInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "order transition details are invalid")
	case errors.Is(err, postgres.ErrOrderAdjustmentFinancialRequired):
		writeError(w, http.StatusConflict, "ORDER_ADJUSTMENT_RECONCILIATION_REQUIRED", "open Order adjustments must be decided and financially reconciled before this transition can proceed")
	case errors.Is(err, postgres.ErrOrderAdjustmentConflict):
		writeError(w, http.StatusConflict, "ORDER_ADJUSTMENT_CONFLICT", "Order adjustment state or version is stale, or the adjustment cannot advance this Order")
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
	case errors.Is(err, postgres.ErrStorePickupProofInvalid):
		writeError(w, http.StatusConflict, "DELIVERY_PROOF_INVALID", "the customer pickup code is incorrect; the order was not finalized")
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
