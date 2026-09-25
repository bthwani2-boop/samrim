package transporthttp

import (
	"io"
	"net/http"
	"strconv"
	"strings"
)

func (s *BeneficiaryFinanceServer) RegisterCustomerWithdrawalGovernance(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/operator/customer-withdrawal-request-evidence", s.uploadCustomerWithdrawalRequestEvidence)
	mux.HandleFunc("POST /dsh/operator/customer-withdrawal-intakes", s.createCustomerWithdrawalIntake)
	mux.HandleFunc("GET /dsh/operator/customer-withdrawal-intakes", s.listCustomerWithdrawalIntakes)
	mux.HandleFunc("GET /dsh/operator/customer-withdrawal-intakes/{intakeId}", s.readCustomerWithdrawalIntake)
	mux.HandleFunc("POST /dsh/operator/customer-withdrawal-intakes/{intakeId}/prepare-destination", s.prepareCustomerWithdrawalDestination)
	mux.HandleFunc("POST /dsh/operator/customer-withdrawal-intakes/{intakeId}/verify-destination", s.verifyCustomerWithdrawalDestination)
	mux.HandleFunc("POST /dsh/operator/customer-withdrawal-intakes/{intakeId}/activate-destination", s.activateCustomerWithdrawalDestination)
	mux.HandleFunc("POST /dsh/operator/customer-withdrawal-intakes/{intakeId}/accept", s.acceptCustomerWithdrawal)
	mux.HandleFunc("POST /dsh/operator/customer-withdrawal-intakes/{intakeId}/reject", s.rejectCustomerWithdrawal)
}

func (s *BeneficiaryFinanceServer) uploadCustomerWithdrawalRequestEvidence(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperations(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024+64*1024)
	if err := r.ParseMultipartForm(10 * 1024 * 1024); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "customer withdrawal authorization evidence is invalid or exceeds 10 MiB")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "customer withdrawal authorization evidence file is required")
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, 10*1024*1024+1))
	if err != nil || len(content) == 0 || len(content) > 10*1024*1024 {
		writeError(w, http.StatusBadRequest, "INVALID_UPLOAD", "customer withdrawal authorization evidence is invalid or exceeds 10 MiB")
		return
	}
	document, err := s.payment.UploadFinanceEvidenceDocument(r.Context(), "CUSTOMER_WITHDRAWAL_REQUEST", header.Filename, content, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"document": document})
}

func (s *BeneficiaryFinanceServer) createCustomerWithdrawalIntake(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperations(w, r) {
		return
	}
	var input struct {
		CustomerActorID           string `json:"customerActorId"`
		ProviderKey               string `json:"providerKey"`
		WalletIdentifier          string `json:"walletIdentifier"`
		RequestReason             string `json:"requestReason"`
		RequestEvidenceDocumentID string `json:"requestEvidenceDocumentId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.CustomerActorID = strings.TrimSpace(input.CustomerActorID)
	role, err := s.identity.ReadActorRole(r.Context(), input.CustomerActorID, "client")
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	if role.Role != "client" || !role.Enabled || !role.SecurityEnabled {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active Customer Identity is required for an Operations withdrawal request")
		return
	}
	legalName, err := s.identity.ReadVerifiedActorLegalName(r.Context(), input.CustomerActorID, acting)
	if err != nil {
		writeIdentityError(w, err)
		return
	}
	beneficiaryName := strings.Join([]string{legalName.GivenName, legalName.SecondName, legalName.ThirdName, legalName.FamilyName}, " ")
	item, replayed, err := s.payment.CreateCustomerWithdrawalIntake(r.Context(), input.CustomerActorID, input.ProviderKey, input.WalletIdentifier, beneficiaryName, legalName.Version, input.RequestReason, input.RequestEvidenceDocumentID, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	state, err := s.payment.ReadPayoutState(r.Context(), "customer", item.CustomerActorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	item.Currency = state.Currency
	item.EligibleAvailableMinor = state.EligibleAvailableMinor
	item.HeldMinor = state.HeldMinor
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"intake": item, "idempotentReplay": replayed})
}

func (s *BeneficiaryFinanceServer) listCustomerWithdrawalIntakes(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "customer withdrawal queue limit is invalid")
			return
		}
		limit = parsed
	}
	items, err := s.payment.ListCustomerWithdrawalIntakes(r.Context(), status, limit, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	for index := range items {
		state, stateErr := s.payment.ReadPayoutState(r.Context(), "customer", items[index].CustomerActorID)
		if stateErr != nil {
			writeWLTFinanceError(w, stateErr)
			return
		}
		items[index].Currency = state.Currency
		items[index].EligibleAvailableMinor = state.EligibleAvailableMinor
		items[index].HeldMinor = state.HeldMinor
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intakes": items, "limit": limit})
}

func (s *BeneficiaryFinanceServer) readCustomerWithdrawalIntake(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	item, err := s.payment.ReadCustomerWithdrawalIntake(r.Context(), r.PathValue("intakeId"), strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	state, err := s.payment.ReadPayoutState(r.Context(), "customer", item.CustomerActorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	item.Currency = state.Currency
	item.EligibleAvailableMinor = state.EligibleAvailableMinor
	item.HeldMinor = state.HeldMinor
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": item})
}

func (s *BeneficiaryFinanceServer) prepareCustomerWithdrawalDestination(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	destination, err := s.payment.PrepareCustomerWithdrawalDestination(r.Context(), r.PathValue("intakeId"), input.Reason, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"destination": destination})
}

func (s *BeneficiaryFinanceServer) verifyCustomerWithdrawalDestination(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input struct {
		EvidenceReference string `json:"evidenceReference"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	intake, err := s.payment.ReadCustomerWithdrawalIntake(r.Context(), r.PathValue("intakeId"), acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if intake.DestinationID == nil {
		writeError(w, http.StatusConflict, "DESTINATION_UNAVAILABLE", "the Finance-prepared wallet destination is missing")
		return
	}
	destination, err := s.payment.VerifyOfficialWalletDestination(r.Context(), *intake.DestinationID, input.EvidenceReference, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *BeneficiaryFinanceServer) activateCustomerWithdrawalDestination(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	intake, err := s.payment.ReadCustomerWithdrawalIntake(r.Context(), r.PathValue("intakeId"), acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	if intake.DestinationID == nil {
		writeError(w, http.StatusConflict, "DESTINATION_UNAVAILABLE", "the Finance-prepared wallet destination is missing")
		return
	}
	destination, err := s.payment.ActivateOfficialWalletDestination(r.Context(), *intake.DestinationID, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"destination": destination})
}

func (s *BeneficiaryFinanceServer) acceptCustomerWithdrawal(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	payout, err := s.payment.AcceptCustomerWithdrawal(r.Context(), r.PathValue("intakeId"), input.Reason, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"payout": payout})
}

func (s *BeneficiaryFinanceServer) rejectCustomerWithdrawal(w http.ResponseWriter, r *http.Request) {
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok || !s.authorizeAndRequireOperator(w, r) {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	item, err := s.payment.RejectCustomerWithdrawal(r.Context(), r.PathValue("intakeId"), input.Reason, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	state, err := s.payment.ReadPayoutState(r.Context(), "customer", item.CustomerActorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	item.Currency = state.Currency
	item.EligibleAvailableMinor = state.EligibleAvailableMinor
	item.HeldMinor = state.HeldMinor
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": item})
}
