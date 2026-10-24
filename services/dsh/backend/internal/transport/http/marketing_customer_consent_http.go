package transporthttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func (s *MarketingServer) requireMarketingClientActor(w http.ResponseWriter, r *http.Request) (string, bool) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "client session is required")
		return "", false
	}
	if s.identity == nil {
		writeError(w, http.StatusServiceUnavailable, "IDENTITY_UNAVAILABLE", "identity service unavailable")
		return "", false
	}
	identity, err := s.identity.ReadSession(r.Context(), token)
	if err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
		} else {
			writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "identity service unavailable")
		}
		return "", false
	}
	if identity.Role != "client" || identity.Surface != "app-client" || strings.TrimSpace(identity.Subject) == "" {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "app-client session is required")
		return "", false
	}
	return strings.TrimSpace(identity.Subject), true
}

func (s *MarketingServer) readClientMarketingConsent(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireMarketingClientActor(w, r)
	if !ok {
		return
	}
	value, err := postgres.ReadPromotionalContactConsent(r.Context(), s.db, actor, r.PathValue("channel"))
	if errors.Is(err, postgres.ErrMarketingConsentInvalid) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid channel")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "consent unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, value)
}

func (s *MarketingServer) changeClientMarketingConsent(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.requireMarketingClientActor(w, r)
	if !ok {
		return
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	rawVersion := strings.TrimSpace(r.Header.Get("X-Expected-Version"))
	version, err := strconv.Atoi(rawVersion)
	if len(key) < 8 || len(key) > 128 || err != nil || version < 0 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "idempotency key and nonnegative expected version are required")
		return
	}
	var body struct {
		Decision string `json:"decision"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := postgres.ChangePromotionalContactConsent(r.Context(), s.db, postgres.MarketingConsentChange{
		ClientActorID: actor, Channel: r.PathValue("channel"), Purpose: "PROMOTIONS",
		Decision: body.Decision, Source: "CUSTOMER_APP", ExpectedVersion: version, IdempotencyKey: key,
	})
	if errors.Is(err, postgres.ErrMarketingConsentInvalid) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "invalid promotional consent")
		return
	}
	if errors.Is(err, postgres.ErrMarketingConsentConflict) {
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "consent changed; reload current preference")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "consent update unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}
