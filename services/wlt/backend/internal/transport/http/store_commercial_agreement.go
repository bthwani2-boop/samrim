package http

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type storeCommercialAgreementResponse struct {
	Agreement        postgres.StoreCommercialAgreementRecord `json:"agreement"`
	IdempotentReplay bool                                    `json:"idempotentReplay"`
}

type storeCommercialAgreementListResponse struct {
	Agreements []postgres.StoreCommercialAgreementRecord `json:"agreements"`
}

type storeCommercialAgreementPageResponse struct {
	Agreements []postgres.StoreCommercialAgreementRecord `json:"agreements"`
	NextCursor string                                    `json:"nextCursor,omitempty"`
}

type proposeStoreCommercialAgreementRequest struct {
	StoreID                string                                  `json:"storeId"`
	PartnerActorID         string                                  `json:"partnerActorId"`
	Rates                  []postgres.StoreCommercialAgreementRate `json:"rates"`
	ExpectedCurrentVersion int                                     `json:"expectedCurrentVersion"`
	Reason                 string                                  `json:"reason"`
}

type storeCommercialAgreementDecisionRequest struct {
	ExpectedAgreementVersion int    `json:"expectedAgreementVersion"`
	Decision                 string `json:"decision"`
	Reason                   string `json:"reason"`
}

func (s *Server) readStoreCommercialAgreements(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	storeID := strings.TrimSpace(r.URL.Query().Get("storeId"))
	agreements, err := postgres.ReadStoreCommercialAgreements(r.Context(), s.db, storeID)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeCommercialAgreementListResponse{Agreements: agreements})
}

func (s *Server) listStoreCommercialAgreementsForFinance(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	status := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("status")))
	if status == "" {
		status = "PARTNER_ACCEPTED"
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 50 {
			writeStoreCommercialAgreementError(w, postgres.ErrStoreCommercialAgreementInvalidInput)
			return
		}
		limit = parsed
	}
	var before *time.Time
	beforeID := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		parts := strings.SplitN(string(decoded), "|", 2)
		if err != nil || len(decoded) > 640 || len(parts) != 2 || len(strings.TrimSpace(parts[1])) < 1 || len(strings.TrimSpace(parts[1])) > 128 {
			writeStoreCommercialAgreementError(w, postgres.ErrStoreCommercialAgreementInvalidInput)
			return
		}
		parsed, err := time.Parse(time.RFC3339Nano, parts[0])
		if err != nil {
			writeStoreCommercialAgreementError(w, postgres.ErrStoreCommercialAgreementInvalidInput)
			return
		}
		before, beforeID = &parsed, strings.TrimSpace(parts[1])
	}
	page, err := postgres.ListStoreCommercialAgreementsForFinance(r.Context(), s.db, status, before, beforeID, limit)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	response := storeCommercialAgreementPageResponse{Agreements: page.Agreements}
	if page.NextCursor != "" {
		response.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(page.NextCursor))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) proposeStoreCommercialAgreement(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlationID, idempotencyKey, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input proposeStoreCommercialAgreementRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	agreement, replayed, err := postgres.ProposeStoreCommercialAgreement(r.Context(), s.db, postgres.ProposeStoreCommercialAgreementInput{
		StoreID: input.StoreID, PartnerActorID: input.PartnerActorID, Rates: input.Rates,
		ExpectedCurrentVersion: input.ExpectedCurrentVersion, ActorID: actorID, Reason: input.Reason,
		IdempotencyKey: idempotencyKey, CorrelationID: correlationID,
	})
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, storeCommercialAgreementResponse{Agreement: agreement, IdempotentReplay: replayed})
}

func (s *Server) acceptStoreCommercialAgreement(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlationID, idempotencyKey, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input struct {
		ExpectedAgreementVersion int    `json:"expectedAgreementVersion"`
		Reason                   string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	agreement, replayed, err := postgres.AcceptStoreCommercialAgreement(r.Context(), s.db, r.PathValue("agreementId"), input.ExpectedAgreementVersion, actorID, input.Reason, idempotencyKey, correlationID)
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeCommercialAgreementResponse{Agreement: agreement, IdempotentReplay: replayed})
}

func (s *Server) decideStoreCommercialAgreement(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actorID, correlationID, idempotencyKey, ok := operatorMutationHeaders(w, r)
	if !ok || !s.requireOperatorID(w, actorID) {
		return
	}
	var input storeCommercialAgreementDecisionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	agreement, replayed, err := postgres.DecideStoreCommercialAgreement(r.Context(), s.db, postgres.StoreCommercialAgreementDecisionInput{
		AgreementID: r.PathValue("agreementId"), ExpectedVersion: input.ExpectedAgreementVersion,
		Decision: input.Decision, ActorID: actorID, Reason: input.Reason,
		IdempotencyKey: idempotencyKey, CorrelationID: correlationID,
	})
	if err != nil {
		writeStoreCommercialAgreementError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storeCommercialAgreementResponse{Agreement: agreement, IdempotentReplay: replayed})
}

func writeStoreCommercialAgreementError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrStoreCommercialAgreementNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "store commercial agreement was not found")
	case errors.Is(err, postgres.ErrStoreCommercialAgreementVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "store commercial agreement changed; reload before deciding")
	case errors.Is(err, postgres.ErrStoreCommercialAgreementState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "store commercial agreement state does not allow this operation")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different agreement facts")
	case errors.Is(err, postgres.ErrStoreCommercialAgreementUnavailable):
		writeError(w, http.StatusConflict, "STORE_COMMERCIAL_AGREEMENT_REQUIRED", "an active Store-specific commercial agreement is required")
	case errors.Is(err, postgres.ErrStoreCommercialAgreementInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "store commercial agreement input is invalid")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT agreement persistence is unavailable")
	}
}
