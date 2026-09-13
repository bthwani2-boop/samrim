package transporthttp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	contract "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/partnerbootstrap"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storepublication"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

const CreatePermission = "partner.bootstrap.create"

type PartnerBootstrapServer struct {
	auth        *auth.ServiceToken
	service     *partnerbootstrap.Service
	publication *storepublication.Service
}

func NewPartnerBootstrap(identityClient *identity.Client, accessToken string, db *sql.DB, publication *storepublication.Service) (*PartnerBootstrapServer, error) {
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	if publication == nil {
		return nil, errors.New("partner bootstrap publication readiness is invalid")
	}
	service, err := partnerbootstrap.New(identityClient, db)
	if err != nil {
		return nil, err
	}
	return &PartnerBootstrapServer{auth: authorizer, service: service, publication: publication}, nil
}

func (s *PartnerBootstrapServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /dsh/partner-bootstrap", s.create)
	mux.HandleFunc("GET /dsh/partner-bootstrap/{partnerActorId}", s.readForOperator)
	mux.HandleFunc("GET /dsh/partner-bootstrap/self", s.readForPartner)
}

func (s *PartnerBootstrapServer) create(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Actor-ID and If-Match are forbidden")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreatePartnerBootstrapRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	record, err := s.service.Create(r.Context(), idempotency, acting, correlation, input.PartnerActorID, input.StoreName)
	if err != nil {
		if strings.Contains(err.Error(), "partner actor and store name") {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "partnerActorId and a storeName of 2 to 160 characters are required")
			return
		}
		if errors.Is(err, partnerbootstrap.ErrPartnerNotActive) {
			writeStorageError(w, err)
			return
		}
		writePartnerIdentityError(w, err)
		return
	}
	status := http.StatusCreated
	if record.Replayed {
		status = http.StatusOK
	}
	s.writeBootstrap(w, r.Context(), status, record)
}

func (s *PartnerBootstrapServer) readForOperator(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")) == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	record, err := s.service.ReadForOperator(r.Context(), r.PathValue("partnerActorId"))
	if err != nil {
		writeStorageError(w, err)
		return
	}
	s.writeBootstrap(w, r.Context(), http.StatusOK, record)
}

func (s *PartnerBootstrapServer) readForPartner(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "partner session is required")
		return
	}
	record, err := s.service.ReadForPartner(r.Context(), token)
	if err != nil {
		if strings.Contains(err.Error(), "active app-partner") {
			writeStorageError(w, err)
		} else {
			writePartnerIdentityError(w, err)
		}
		return
	}
	s.writeBootstrap(w, r.Context(), http.StatusOK, record)
}

func (s *PartnerBootstrapServer) writeBootstrap(w http.ResponseWriter, ctx context.Context, status int, record postgres.BootstrapRecord) {
	readiness, err := s.publication.ReadinessForStore(ctx, record.Store)
	if err != nil {
		writeStorePublicationError(w, err)
		return
	}
	writeBootstrapResponse(w, status, record, readiness)
}

func writePartnerIdentityError(w http.ResponseWriter, err error) {
	var identityErr *identityclient.Error
	if errors.As(err, &identityErr) && identityErr.Status == http.StatusNotFound {
		writeError(w, http.StatusNotFound, "PARTNER_NOT_FOUND", "partner actor was not found")
		return
	}
	writeIdentityError(w, err)
}

func requiredMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(acting) == 0 || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID, X-Correlation-ID, and Idempotency-Key are required")
		return "", "", "", false
	}
	return acting, correlation, idempotency, true
}

func writeBootstrapResponse(w http.ResponseWriter, status int, record postgres.BootstrapRecord, readiness storepublication.PublicationReadiness) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contract.PartnerBootstrapResponse{
		PartnerActorID:   record.PartnerActorID,
		FirstStore:       toStoreView(record.Store, readiness),
		IdempotentReplay: record.Replayed,
	})
}
