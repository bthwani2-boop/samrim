package transporthttp

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	dshcontract "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
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

func projectCustomerWithdrawalIntake(item wltintegration.CustomerWithdrawalIntake, state wltintegration.PayoutState) dshcontract.CustomerWithdrawalIntake {
	return dshcontract.CustomerWithdrawalIntake{
		ID: item.ID, CustomerActorID: item.CustomerActorID, ProviderKey: item.ProviderKey,
		WalletIdentifierMasked: item.WalletIdentifierMasked, BeneficiaryName: item.BeneficiaryName,
		BeneficiaryIdentityVersion: item.BeneficiaryIdentityVersion, RequestReason: item.RequestReason,
		RequestEvidenceDocumentID: item.RequestEvidenceDocumentID, Status: item.Status,
		DestinationID: withdrawalString(item.DestinationID), PayoutID: withdrawalString(item.PayoutID),
		PayoutStatus: withdrawalString(item.PayoutStatus), PayoutAmountMinor: withdrawalAmount(item.PayoutAmountMinor),
		PayoutCurrency: withdrawalString(item.PayoutCurrency), RequestedBy: item.RequestedBy,
		RequestedAt: item.RequestedAt, FinanceActorID: withdrawalString(item.FinanceActorID),
		ResolvedAt: item.ResolvedAt, ResolutionReason: withdrawalString(item.ResolutionReason),
		Currency: state.Currency, EligibleAvailableMinor: int(state.EligibleAvailableMinor), HeldMinor: int(state.HeldMinor),
	}
}

func projectCustomerWithdrawalIntakeSummary(item wltintegration.CustomerWithdrawalIntakeSummary) dshcontract.CustomerWithdrawalIntakeSummary {
	return dshcontract.CustomerWithdrawalIntakeSummary{
		ID: item.ID, CustomerActorID: item.CustomerActorID, ProviderKey: item.ProviderKey,
		WalletIdentifierMasked: item.WalletIdentifierMasked, BeneficiaryName: item.BeneficiaryName,
		Status: item.Status, DestinationID: withdrawalString(item.DestinationID),
		DestinationStatus:             withdrawalString(item.DestinationStatus),
		DestinationVerificationStatus: withdrawalString(item.DestinationVerificationStatus),
		PayoutID:                      withdrawalString(item.PayoutID), PayoutStatus: withdrawalString(item.PayoutStatus),
		PayoutAmountMinor: withdrawalAmount(item.PayoutAmountMinor), PayoutCurrency: withdrawalString(item.PayoutCurrency),
		RequestedAt: item.RequestedAt,
	}
}

func withdrawalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func withdrawalAmount(value *int64) int {
	if value == nil {
		return 0
	}
	return int(*value)
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
		RequestReason             string `json:"requestReason"`
		RequestEvidenceDocumentID string `json:"requestEvidenceDocumentId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	activeProvider, providerErr := postgres.IsActiveWalletProvider(r.Context(), s.db, input.ProviderKey)
	if providerErr != nil {
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
		return
	}
	if !activeProvider {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "providerKey must be an active wallet provider")
		return
	}
	input.CustomerActorID = strings.TrimSpace(input.CustomerActorID)
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), "customer", input.CustomerActorID, acting)
	if err != nil {
		if errors.Is(err, errOfficialWalletIdentityNotVerified) {
			writeError(w, http.StatusConflict, "OFFICIAL_WALLET_IDENTITY_REQUIRED", "a current verified Customer phone and legal name are required")
			return
		}
		writeIdentityError(w, err)
		return
	}
	item, replayed, err := s.payment.CreateCustomerWithdrawalIntake(r.Context(), input.CustomerActorID, input.ProviderKey, identityFacts, input.RequestReason, input.RequestEvidenceDocumentID, idempotency, correlation, acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	state, err := s.payment.ReadPayoutState(r.Context(), "customer", item.CustomerActorID)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	intake := projectCustomerWithdrawalIntake(item, state)
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"intake": intake, "idempotentReplay": replayed})
}

func (s *BeneficiaryFinanceServer) listCustomerWithdrawalIntakes(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAndRequireOperator(w, r) {
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	sort := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort")))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if sort == "" {
		sort = "requested_desc"
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "customer withdrawal queue limit is invalid")
			return
		}
		limit = parsed
	}
	if utf8.RuneCountInString(search) > 128 || len(cursor) > 1024 || (sort != "requested_asc" && sort != "requested_desc") {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "customer withdrawal registry query is invalid")
		return
	}
	result, err := s.payment.ListCustomerWithdrawalIntakes(r.Context(), status, search, sort, cursor, limit, strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")))
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	intakes := make([]dshcontract.CustomerWithdrawalIntakeSummary, 0, len(result.Intakes))
	for _, item := range result.Intakes {
		intakes = append(intakes, projectCustomerWithdrawalIntakeSummary(item))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, dshcontract.CustomerWithdrawalIntakeListResponse{Intakes: intakes, NextCursor: result.NextCursor, Limit: result.Limit})
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
	intake := projectCustomerWithdrawalIntake(item, state)
	var destination *dshcontract.CustomerWithdrawalDestinationSummary
	if item.DestinationID != nil {
		readDestination, destinationErr := s.payment.ReadOfficialWalletDestinationByID(r.Context(), *item.DestinationID)
		if destinationErr != nil {
			writeWLTFinanceError(w, destinationErr)
			return
		}
		if readDestination.ID != *item.DestinationID || readDestination.ActorType != "customer" || readDestination.ActorID != item.CustomerActorID {
			writeError(w, http.StatusConflict, "DESTINATION_MISMATCH", "the intake wallet destination no longer matches its recorded destination")
			return
		}
		destination = &dshcontract.CustomerWithdrawalDestinationSummary{
			ID: readDestination.ID, Status: readDestination.Status,
			VerificationStatus:     readDestination.VerificationStatus,
			WalletIdentifierMasked: readDestination.WalletIdentifierMasked,
			BeneficiaryName:        readDestination.BeneficiaryName, Version: readDestination.Version,
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	response := map[string]any{"intake": intake}
	if destination != nil {
		response["destination"] = destination
	}
	writeJSON(w, http.StatusOK, response)
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
	intake, err := s.payment.ReadCustomerWithdrawalIntake(r.Context(), r.PathValue("intakeId"), acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), "customer", intake.CustomerActorID, acting)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	destination, err := s.payment.PrepareCustomerWithdrawalDestination(r.Context(), r.PathValue("intakeId"), identityFacts, input.Reason, idempotency, correlation, acting)
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
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), "customer", intake.CustomerActorID, acting)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	destination, err := s.payment.VerifyOfficialWalletDestination(r.Context(), *intake.DestinationID, input.EvidenceReference, identityFacts, idempotency, correlation, acting)
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
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), "customer", intake.CustomerActorID, acting)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	destination, err := s.payment.ActivateOfficialWalletDestination(r.Context(), *intake.DestinationID, identityFacts, idempotency, correlation, acting)
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
	intake, err := s.payment.ReadCustomerWithdrawalIntake(r.Context(), r.PathValue("intakeId"), acting)
	if err != nil {
		writeWLTFinanceError(w, err)
		return
	}
	identityFacts, err := s.readCurrentOfficialWalletIdentityFacts(r.Context(), "customer", intake.CustomerActorID, acting)
	if err != nil {
		writeOfficialWalletIdentityReadError(w, err)
		return
	}
	payout, err := s.payment.AcceptCustomerWithdrawal(r.Context(), r.PathValue("intakeId"), identityFacts, input.Reason, idempotency, correlation, acting)
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
	intake := projectCustomerWithdrawalIntake(item, state)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"intake": intake})
}
