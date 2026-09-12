package transporthttp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/partnerbootstrap"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body is invalid")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body must contain exactly one JSON value")
		return false
	}
	return true
}

func bearerToken(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
}

func writeIdentityError(w http.ResponseWriter, err error) {
	var identityErr *identityclient.Error
	if errors.As(err, &identityErr) {
		status := identityErr.Status
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		writeError(w, status, identityErr.Code, identityErr.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "identity service is unavailable")
}

func writeStorageError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrBootstrapNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "partner bootstrap was not found")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request")
	case errors.Is(err, postgres.ErrAlreadyBootstrapped):
		writeError(w, http.StatusConflict, "PARTNER_ALREADY_BOOTSTRAPPED", "partner already has a canonical first store")
	case errors.Is(err, partnerbootstrap.ErrPartnerNotActive):
		writeError(w, http.StatusConflict, "PARTNER_NOT_ACTIVE", "partner actor is not active")
	case errors.Is(err, partnerbootstrap.ErrPartnerSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
	default:
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
	}
}

func writeRoleStatus(w http.ResponseWriter, status contract.ManagedRoleStatusResponse) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(status)
}

func toRoleView(view identityclient.ActorRoleView) contract.ActorRoleView {
	return contract.ActorRoleView{
		ActorID: view.ActorID, PhoneE164: view.PhoneE164, Role: view.Role, Enabled: view.Enabled,
		ActivatedAt: view.ActivatedAt, SecurityEnabled: view.SecurityEnabled,
		ActorVersion: view.ActorVersion, RoleVersion: view.RoleVersion, CredentialVersion: view.CredentialVersion,
		ActorCreated: view.ActorCreated, RoleCreated: view.RoleCreated,
	}
}
