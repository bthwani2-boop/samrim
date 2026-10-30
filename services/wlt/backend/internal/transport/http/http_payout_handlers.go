package http

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func (s *Server) createPayoutIntent(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input payoutIntentRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.EqualFold(strings.TrimSpace(input.ActorType), "customer") {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "customer withdrawals require a linked Operations intake and cannot use the general payout-intent route")
		return
	}
	result, replayed, err := postgres.CreatePayoutIntent(r.Context(), s.db, s.destinationEncryptionKey, postgres.PayoutIntentInput{ActorType: input.ActorType, ActorID: input.ActorID, AmountMode: input.AmountMode, AmountMinor: input.AmountMinor, IdentityFacts: input.IdentityFacts, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePayoutError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, payoutRequestResponse{Payout: toPayoutRequest(result), IdempotentReplay: replayed})
}

func (s *Server) readPayoutState(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ReadPayoutState(r.Context(), s.db, r.PathValue("actorType"), r.PathValue("actorId"))
	if err != nil {
		writePayoutError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payoutStateResponse{State: toPayoutState(result)})
}

func (s *Server) listBeneficiaryPayoutStates(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) || !s.requireActingOperator(w, r) {
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "beneficiary page limit is invalid")
			return
		}
		limit = parsed
	}
	sortKey := strings.TrimSpace(r.URL.Query().Get("sort"))
	if sortKey == "" {
		sortKey = "actor_asc"
	}
	if !postgres.ValidBeneficiaryRegistrySort(sortKey) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "beneficiary sort is invalid")
		return
	}
	var cursorState beneficiaryPayoutRegistryCursor
	if cursor := strings.TrimSpace(r.URL.Query().Get("cursor")); cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || len(decoded) > 384 || json.Unmarshal(decoded, &cursorState) != nil || cursorState.Sort != sortKey || cursorState.ActorID == "" || !postgres.ValidPayoutRegistryActor(cursorState.ActorType) {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "beneficiary cursor is invalid")
			return
		}
	}
	items, more, err := postgres.ListBeneficiaryPayoutStates(r.Context(), s.db, r.URL.Query().Get("actorType"), r.URL.Query().Get("search"), r.URL.Query().Get("status"), sortKey, cursorState.SortValue, cursorState.ActorType, cursorState.ActorID, limit)
	if err != nil {
		writePayoutError(w, err)
		return
	}
	result := beneficiaryPayoutRegistryResponse{Beneficiaries: make([]payoutStateJSON, 0, len(items)), Limit: limit}
	for _, item := range items {
		result.Beneficiaries = append(result.Beneficiaries, toPayoutState(item.State))
	}
	if more && len(items) > 0 {
		last := items[len(items)-1]
		cursorBytes, err := json.Marshal(beneficiaryPayoutRegistryCursor{Sort: sortKey, SortValue: last.SortValue, ActorType: last.State.ActorType, ActorID: last.State.ActorID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "beneficiary cursor could not be created")
			return
		}
		result.NextCursor = base64.RawURLEncoding.EncodeToString(cursorBytes)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}
