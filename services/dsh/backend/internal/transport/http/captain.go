package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/captain"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type CaptainServer struct {
	auth    *auth.ServiceToken
	service *captain.Service
}

func NewCaptain(identityClient *identityintegration.Client, accessToken string, db *sql.DB, payment *wlt.Client) (*CaptainServer, error) {
	authorizer, err := auth.NewServiceToken(strings.TrimSpace(accessToken))
	if err != nil {
		return nil, err
	}
	service, err := captain.New(identityClient, db, payment)
	if err != nil {
		return nil, err
	}
	return &CaptainServer{auth: authorizer, service: service}, nil
}

func (s *CaptainServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/captains/admissions", s.admit)
	mux.HandleFunc("GET /dsh/captains/admissions/{admissionId}", s.readAdmission)
	mux.HandleFunc("GET /dsh/captains/actors/{actorId}/admission", s.readAdmissionForActor)
	mux.HandleFunc("GET /dsh/captains/me", s.readOwnAdmission)
	mux.HandleFunc("POST /dsh/captains/me/availability", s.setAvailability)
	mux.HandleFunc("GET /dsh/captains/me/offers", s.listOffers)
	mux.HandleFunc("POST /dsh/captains/me/offers/{offerId}/respond", s.respondToOffer)
	mux.HandleFunc("GET /dsh/captains/me/assignments", s.listAssignments)
	mux.HandleFunc("GET /dsh/captains/me/assignments/{assignmentId}/delivery-task", s.readDeliveryTask)
	mux.HandleFunc("POST /dsh/captains/me/assignments/{assignmentId}/location", s.updateLocation)
	mux.HandleFunc("POST /dsh/captains/me/assignments/{assignmentId}/pickup", s.pickup)
	mux.HandleFunc("POST /dsh/captains/me/assignments/{assignmentId}/complete", s.complete)
	mux.HandleFunc("POST /dsh/captains/assignments/{assignmentId}/recover", s.recover)
	mux.HandleFunc("POST /dsh/orders/{orderId}/dispatch", s.dispatch)
	mux.HandleFunc("POST /dsh/orders/{orderId}/reassign", s.reassign)
	mux.HandleFunc("POST /dsh/stores/{storeId}/orders/{orderId}/handoff", s.confirmHandoff)
	mux.HandleFunc("GET /dsh/stores/{storeId}/orders/{orderId}/captain-assignment", s.readStoreAssignment)
	mux.HandleFunc("POST /dsh/partners/{actorId}/identity-role", s.setPartnerRole)
	mux.HandleFunc("POST /dsh/captains/{actorId}/identity-role", s.setCaptainRole)
}

func (s *CaptainServer) admit(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, _, ok := captainHeaders(w, r, false)
	if !ok || acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID, X-Correlation-ID, and Idempotency-Key are required")
		return
	}
	var input contract.CaptainAdmissionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	admission, replayed, err := s.service.Admit(r.Context(), input.ContactPhoneE164, idempotency, acting, correlation)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.CaptainAdmissionResponse{Admission: toCaptainAdmission(admission), IdempotentReplay: replayed})
}

func (s *CaptainServer) readAdmission(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	admission, err := s.service.ReadForOperator(r.Context(), r.PathValue("admissionId"), acting)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAdmissionResponse{Admission: toCaptainAdmission(admission)})
}

func (s *CaptainServer) readAdmissionForActor(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	admission, err := s.service.ReadForOperatorByActor(r.Context(), r.PathValue("actorId"), acting)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAdmissionResponse{Admission: toCaptainAdmission(admission)})
}

func (s *CaptainServer) readOwnAdmission(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	admission, err := s.service.ReadForCaptain(r.Context(), bearerToken(r))
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAdmissionResponse{Admission: toCaptainAdmission(admission)})
}

func (s *CaptainServer) setAvailability(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	_, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.CaptainAvailabilityRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	admission, replayed, err := s.service.SetAvailability(r.Context(), bearerToken(r), input.Available, expected, idempotency, correlation)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAdmissionResponse{Admission: toCaptainAdmission(admission), IdempotentReplay: replayed})
}

func (s *CaptainServer) listOffers(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	limit, ok := captainLimit(w, r)
	if !ok {
		return
	}
	offers, err := s.service.ListOffers(r.Context(), bearerToken(r), limit)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	items := make([]contract.CaptainOffer, 0, len(offers))
	for _, offer := range offers {
		items = append(items, toCaptainOffer(offer))
	}
	writeJSON(w, http.StatusOK, contract.CaptainOfferListResponse{Offers: items})
}

func (s *CaptainServer) respondToOffer(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	_, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.CaptainOfferDecisionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.RespondToOffer(r.Context(), bearerToken(r), r.PathValue("offerId"), input.Decision, expected, idempotency, correlation)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toCaptainOfferResponse(result))
}

func (s *CaptainServer) listAssignments(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	limit, ok := captainLimit(w, r)
	if !ok {
		return
	}
	assignments, err := s.service.ListAssignments(r.Context(), bearerToken(r), limit)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	items := make([]contract.CaptainAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		items = append(items, toCaptainAssignment(assignment))
	}
	writeJSON(w, http.StatusOK, contract.CaptainAssignmentListResponse{Assignments: items})
}

func (s *CaptainServer) readDeliveryTask(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	task, err := s.service.ReadDeliveryTask(r.Context(), bearerToken(r), r.PathValue("assignmentId"))
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainDeliveryTaskResponse{Task: contract.CaptainDeliveryTask{
		AssignmentID: task.AssignmentID, OrderReference: task.OrderReference, StoreID: task.StoreID, StoreName: task.StoreName,
		PickupOrigin: contract.CaptainLocation{Latitude: task.PickupLatitude, Longitude: task.PickupLongitude}, CustomerAddressText: task.CustomerAddressText,
		CustomerDestination: contract.CaptainLocation{Latitude: task.DestinationLatitude, Longitude: task.DestinationLongitude}, OrderState: contract.OrderState(task.OrderState),
		HandoffState: task.HandoffState, DeliveryState: task.DeliveryState, PaymentMethod: contract.PaymentMethod(task.PaymentMethod), PaymentState: contract.PaymentState(task.PaymentState), AmountDueMinor: int(task.AmountDueMinor), Currency: task.Currency,
	}})
}

func (s *CaptainServer) pickup(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	_, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok {
		return
	}
	assignment, replayed, err := s.service.Pickup(r.Context(), bearerToken(r), r.PathValue("assignmentId"), expected, idempotency, correlation)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAssignmentResponse{Assignment: toCaptainAssignment(assignment), IdempotentReplay: replayed})
}

func (s *CaptainServer) updateLocation(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	_, correlation, idempotency, _, ok := captainHeaders(w, r, false)
	if !ok {
		return
	}
	if idempotency == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Idempotency-Key is required")
		return
	}
	var input contract.CaptainLocationUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.service.UpdateLocation(r.Context(), bearerToken(r), r.PathValue("assignmentId"), input.Latitude, input.Longitude, idempotency, correlation)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainLocationResponse{Location: toCaptainLocationSnapshot(result.Location), IdempotentReplay: result.Replayed})
}

func (s *CaptainServer) complete(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Captain session is required")
		return
	}
	_, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.CaptainCompletionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	assignment, replayed, err := s.service.Complete(r.Context(), bearerToken(r), r.PathValue("assignmentId"), input.Result, int64(input.CollectedAmountMinor), input.DeliveryProofCode, expected, idempotency, correlation)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAssignmentResponse{Assignment: toCaptainAssignment(assignment), IdempotentReplay: replayed})
}

func (s *CaptainServer) recover(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok || acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID, X-Correlation-ID, Idempotency-Key, and X-Expected-Version are required")
		return
	}
	assignment, replayed, err := s.service.Recover(r.Context(), r.PathValue("assignmentId"), acting, expected, idempotency, correlation)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAssignmentResponse{Assignment: toCaptainAssignment(assignment), IdempotentReplay: replayed})
}

func (s *CaptainServer) dispatch(w http.ResponseWriter, r *http.Request) {
	s.dispatchOrReassign(w, r, false)
}

func (s *CaptainServer) reassign(w http.ResponseWriter, r *http.Request) {
	s.dispatchOrReassign(w, r, true)
}

func (s *CaptainServer) dispatchOrReassign(w http.ResponseWriter, r *http.Request, reassign bool) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, _, ok := captainHeaders(w, r, false)
	if !ok || acting == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID, X-Correlation-ID, and Idempotency-Key are required")
		return
	}
	var offer postgres.CaptainOffer
	var replayed bool
	var err error
	if reassign {
		offer, replayed, err = s.service.Reassign(r.Context(), r.PathValue("orderId"), acting, idempotency, correlation)
	} else {
		offer, replayed, err = s.service.Dispatch(r.Context(), r.PathValue("orderId"), acting, idempotency, correlation)
	}
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, contract.CaptainOfferResponse{Offer: toCaptainOffer(offer), IdempotentReplay: replayed})
}

func (s *CaptainServer) confirmHandoff(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Store partner session is required")
		return
	}
	_, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok {
		return
	}
	var input contract.CaptainHandoffRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	assignment, replayed, err := s.service.ConfirmStoreHandoff(r.Context(), bearerToken(r), r.PathValue("orderId"), r.PathValue("storeId"), input.AssignmentID, expected, idempotency, correlation)
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAssignmentResponse{Assignment: toCaptainAssignment(assignment), IdempotentReplay: replayed})
}

func (s *CaptainServer) readStoreAssignment(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Store partner session is required")
		return
	}
	assignment, err := s.service.ReadForPartner(r.Context(), bearerToken(r), r.PathValue("storeId"), r.PathValue("orderId"))
	if err != nil {
		writeCaptainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.CaptainAssignmentResponse{Assignment: toCaptainAssignment(assignment)})
}

func (s *CaptainServer) setPartnerRole(w http.ResponseWriter, r *http.Request) {
	s.setManagedRole(w, r, "partner")
}

func (s *CaptainServer) setCaptainRole(w http.ResponseWriter, r *http.Request) {
	s.setManagedRole(w, r, "captain")
}

func (s *CaptainServer) setManagedRole(w http.ResponseWriter, r *http.Request, role string) {
	if !s.authorizedService(w, r) {
		return
	}
	acting, correlation, idempotency, expected, ok := captainHeaders(w, r, true)
	if !ok || acting == "" || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID, X-Correlation-ID, and X-Expected-Version are required")
		return
	}
	var input contract.ManagedRoleMutationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := s.service.SetManagedRoleEnabled(r.Context(), role, r.PathValue("actorId"), acting, correlation, idempotency, input.Reason, expected, input.Enabled); err != nil {
		writeCaptainError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *CaptainServer) authorizedService(w http.ResponseWriter, r *http.Request) bool {
	if s.auth.Authorized(r) {
		return true
	}
	writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
	return false
}

func captainHeaders(w http.ResponseWriter, r *http.Request, requireExpected bool) (string, string, string, int, bool) {
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	expected := 0
	if raw := strings.TrimSpace(r.Header.Get("X-Expected-Version")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
			return "", "", "", 0, false
		}
		expected = parsed
	}
	if len(correlation) < 8 || len(correlation) > 128 || (idempotency != "" && (len(idempotency) < 8 || len(idempotency) > 128)) || (requireExpected && expected < 1) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Captain mutation attribution is invalid")
		return "", "", "", 0, false
	}
	if requireExpected && idempotency == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Idempotency-Key is required")
		return "", "", "", 0, false
	}
	return acting, correlation, idempotency, expected, true
}

func captainLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
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

func toCaptainAdmission(value postgres.CaptainAdmission) contract.CaptainAdmission {
	return contract.CaptainAdmission{ID: value.ID, ActorID: value.ActorID, State: value.State, AvailabilityState: value.AvailabilityState, Version: value.Version, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}

func toCaptainOffer(value postgres.CaptainOffer) contract.CaptainOffer {
	return contract.CaptainOffer{ID: value.ID, OrderID: value.OrderID, CaptainActorID: value.CaptainActorID, State: value.State, ExpiresAt: value.ExpiresAt, Version: value.Version, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}

func toCaptainAssignment(value postgres.CaptainAssignment) contract.CaptainAssignment {
	return contract.CaptainAssignment{ID: value.ID, OrderID: value.OrderID, CaptainActorID: value.CaptainActorID, AcceptedOfferID: value.AcceptedOfferID, State: value.State, Version: value.Version, CustodyStartedAt: value.CustodyStartedAt, TerminalResult: value.TerminalResult, TerminalAt: value.TerminalAt, Handoff: contract.CaptainHandoff{AssignmentID: value.Handoff.AssignmentID, OrderID: value.Handoff.OrderID, StoreID: value.Handoff.StoreID, State: value.Handoff.State, Version: value.Handoff.Version, StoreConfirmedAt: value.Handoff.StoreConfirmedAt, CaptainPickedUpAt: value.Handoff.CaptainPickedUpAt}, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}

func toCaptainLocationSnapshot(value postgres.CaptainLocationSnapshot) contract.CaptainLocationSnapshot {
	return contract.CaptainLocationSnapshot{Latitude: value.Latitude, Longitude: value.Longitude, UpdatedAt: value.UpdatedAt}
}

func toCaptainOfferResponse(value postgres.CaptainOfferResult) contract.CaptainOfferResponse {
	result := contract.CaptainOfferResponse{Offer: toCaptainOffer(value.Offer), IdempotentReplay: value.Replayed}
	if value.Assignment != nil {
		assignment := toCaptainAssignment(*value.Assignment)
		result.Assignment = &assignment
	}
	return result
}

func writeCaptainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, captain.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "Captain input is invalid")
	case errors.Is(err, captain.ErrCaptainSessionForbidden), errors.Is(err, captain.ErrPartnerSessionForbidden), errors.Is(err, captain.ErrOperatorNotActive), errors.Is(err, captain.ErrManagedRoleClosed):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "the authenticated actor is not permitted for this Captain operation")
	case errors.Is(err, postgres.ErrCaptainAdmissionNotFound), errors.Is(err, postgres.ErrCaptainOfferNotFound), errors.Is(err, postgres.ErrCaptainAssignmentNotFound), errors.Is(err, postgres.ErrCaptainDeliveryTaskNotFound), errors.Is(err, postgres.ErrOrderNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Captain operational resource was not found")
	case errors.Is(err, postgres.ErrCaptainLocationNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Captain location assignment was not found")
	case errors.Is(err, postgres.ErrCaptainAdmissionExists), errors.Is(err, postgres.ErrCaptainAdmissionConflict), errors.Is(err, postgres.ErrCaptainOperationConflict), errors.Is(err, postgres.ErrCaptainDispatchConflict), errors.Is(err, postgres.ErrCaptainOfferConflict), errors.Is(err, postgres.ErrCaptainAssignmentConflict), errors.Is(err, postgres.ErrCaptainCustodyConflict), errors.Is(err, postgres.ErrCaptainTerminalConflict), errors.Is(err, postgres.ErrCaptainDeliveryTaskInvalid), errors.Is(err, captain.ErrManagedRoleNotEligible), errors.Is(err, captain.ErrManagedRoleVersionConflict), errors.Is(err, postgres.ErrCaptainNoAvailable), errors.Is(err, postgres.ErrCaptainOfferExpired), errors.Is(err, postgres.ErrCaptainOfferForbidden), errors.Is(err, postgres.ErrCaptainNotEligible), errors.Is(err, postgres.ErrCaptainVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_OR_STATE_CONFLICT", "Captain operational state or eligibility is stale or not actionable")
	case errors.Is(err, postgres.ErrDeliveryProofInvalid):
		writeError(w, http.StatusConflict, "DELIVERY_PROOF_INVALID", "the customer delivery code is missing or incorrect; the delivery was not finalized")
	case errors.Is(err, captain.ErrLocationStateConflict):
		writeError(w, http.StatusConflict, "VERSION_OR_STATE_CONFLICT", "Captain location is only available while the assignment is in custody")
	case errors.Is(err, captain.ErrLocationIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different location facts")
	case errors.Is(err, postgres.ErrPaymentStateConflict):
		writeError(w, http.StatusConflict, "PAYMENT_STATE_CONFLICT", "the order payment state is not actionable")
	case errors.Is(err, captain.ErrCollectionAmountMismatch):
		writeError(w, http.StatusConflict, "AMOUNT_MISMATCH", "the collected amount must equal the order amount")
	case errors.Is(err, captain.ErrPaymentUnavailable):
		writeError(w, http.StatusBadGateway, "WLT_PAYMENT_UNAVAILABLE", "cash collection is temporarily unavailable; the delivery was not finalized")
	default:
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
			return
		}
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}
