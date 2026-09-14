package transporthttp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/catalog"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
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
	case errors.Is(err, postgres.ErrJoiningCaseNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "joining case was not found")
	case errors.Is(err, postgres.ErrJoiningCaseIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different joining case facts")
	case errors.Is(err, postgres.ErrJoiningCaseVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "joining case version is stale")
	case errors.Is(err, postgres.ErrJoiningCaseState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "joining case state does not allow this transition")
	case errors.Is(err, postgres.ErrJoiningCaseActor):
		writeError(w, http.StatusConflict, "ACTOR_CONFLICT", "partner actor is already bound to another joining case")
	case errors.Is(err, postgres.ErrJoiningCaseExists):
		writeError(w, http.StatusConflict, "JOINING_CASE_EXISTS", "an active joining case already exists for this phone")
	case errors.Is(err, postgres.ErrJoiningCaseStoreExists):
		writeError(w, http.StatusConflict, "STORE_EXISTS", "partner already has a canonical store")
	case errors.Is(err, catalog.ErrPartnerSessionForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active app-partner session is required")
	case errors.Is(err, catalog.ErrStoreOwnershipForbidden):
		writeError(w, http.StatusForbidden, "FORBIDDEN", "partner store ownership is required")
	default:
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
	}
}

func toStoreView(store postgres.StoreRecord, readiness storepublication.PublicationReadiness, assortments ...[]postgres.StoreAssortmentRecord) contract.StoreView {
	values := []contract.StoreAssortment{}
	if len(assortments) > 0 {
		values = make([]contract.StoreAssortment, 0, len(assortments[0]))
		for _, assortment := range assortments[0] {
			values = append(values, toStoreAssortment(assortment))
		}
	}
	var deliveryOrigin *contract.DeliveryOrigin
	if store.DeliveryOriginLatitude != nil && store.DeliveryOriginLongitude != nil {
		deliveryOrigin = &contract.DeliveryOrigin{Latitude: *store.DeliveryOriginLatitude, Longitude: *store.DeliveryOriginLongitude}
	}
	return contract.StoreView{
		ID: store.ID, PartnerActorID: store.PartnerActorID, Name: store.Name, Version: store.Version,
		PublicationState: contract.PublicationState(store.PublicationState), PublicationChangedAt: store.PublicationChangedAt,
		DeliveryOrigin: deliveryOrigin, CreatedAt: store.CreatedAt, UpdatedAt: store.UpdatedAt,
		Assortments:          values,
		PublicationReadiness: toPublicationReadiness(readiness),
	}
}

func toPublicationReadiness(readiness storepublication.PublicationReadiness) contract.StorePublicationReadiness {
	return contract.StorePublicationReadiness{Ready: readiness.Ready, BlockedReason: readiness.BlockedReason}
}
