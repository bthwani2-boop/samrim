package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/walletprovider"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type WalletProviderServer struct {
	auth    *auth.ServiceToken
	service *walletprovider.Service
	db      *sql.DB
}

func NewWalletProvider(identity *identityintegration.Client, token string, db *sql.DB) (*WalletProviderServer, error) {
	a, e := auth.NewServiceToken(token)
	if e != nil {
		return nil, e
	}
	s, e := walletprovider.New(identity, db)
	if e != nil {
		return nil, e
	}
	return &WalletProviderServer{auth: a, service: s, db: db}, nil
}
func (s *WalletProviderServer) Register(m *http.ServeMux) {
	m.HandleFunc("GET /dsh/public/wallet-providers", s.publicList)
	m.HandleFunc("GET /dsh/wallet-providers", s.list)
	m.HandleFunc("POST /dsh/wallet-providers", s.create)
	m.HandleFunc("PATCH /dsh/wallet-providers/{providerKey}", s.update)
}
func (s *WalletProviderServer) publicList(w http.ResponseWriter, r *http.Request) {
	items, e := postgres.ListWalletProviders(r.Context(), s.db, true)
	if e != nil {
		writeError(w, 502, "DSH_STORAGE_UNAVAILABLE", "DSH persistence is unavailable")
		return
	}
	writeWalletProviderList(w, items)
}
func (s *WalletProviderServer) list(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" || len(actor) > 128 {
		writeError(w, 400, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	all := false
	if raw := strings.TrimSpace(r.URL.Query().Get("includeInactive")); raw != "" {
		v, e := strconv.ParseBool(raw)
		if e != nil {
			writeError(w, 400, "INVALID_INPUT", "includeInactive must be a boolean")
			return
		}
		all = v
	}
	items, e := s.service.List(r.Context(), all, actor)
	if e != nil {
		writeWalletProviderError(w, e)
		return
	}
	writeWalletProviderList(w, items)
}
func (s *WalletProviderServer) create(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actor, corr, idem, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var in struct {
		DisplayNameAr string `json:"displayNameAr"`
		Active        *bool  `json:"active"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Active == nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "active is required")
		return
	}
	result, e := s.service.Create(r.Context(), in.DisplayNameAr, *in.Active, idem, actor, corr)
	if e != nil {
		writeWalletProviderError(w, e)
		return
	}
	writeWalletProviderResult(w, responseStatus(result.Replayed), result)
}
func (s *WalletProviderServer) update(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actor, corr, idem, version, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var in struct {
		DisplayNameAr string `json:"displayNameAr"`
		Active        *bool  `json:"active"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Active == nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "active is required")
		return
	}
	result, e := s.service.Mutate(r.Context(), r.PathValue("providerKey"), in.DisplayNameAr, *in.Active, version, idem, actor, corr)
	if e != nil {
		writeWalletProviderError(w, e)
		return
	}
	writeWalletProviderResult(w, http.StatusOK, result)
}
func (s *WalletProviderServer) authorize(w http.ResponseWriter, r *http.Request) bool {
	if !s.auth.Authorized(r) {
		writeError(w, 401, "UNAUTHENTICATED", "service authentication is required")
		return false
	}
	return true
}
func writeWalletProviderList(w http.ResponseWriter, items []postgres.WalletProvider) {
	values := make([]map[string]any, 0, len(items))
	for _, p := range items {
		values = append(values, map[string]any{"key": p.Key, "displayNameAr": p.DisplayNameAr, "active": p.Active, "version": p.Version})
	}
	writeJSON(w, 200, map[string]any{"walletProviders": values})
}
func writeWalletProviderResult(w http.ResponseWriter, status int, r postgres.WalletProviderResult) {
	p := r.Provider
	writeJSON(w, status, map[string]any{"walletProvider": map[string]any{"key": p.Key, "displayNameAr": p.DisplayNameAr, "active": p.Active, "version": p.Version}, "idempotentReplay": r.Replayed})
}
func writeWalletProviderError(w http.ResponseWriter, e error) {
	switch {
	case errors.Is(e, postgres.ErrWalletProviderInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "wallet provider key or Arabic display name is invalid")
	case errors.Is(e, walletprovider.ErrOperatorNotActive):
		writeError(w, 403, "FORBIDDEN", "an active control operator session is required")
	case errors.Is(e, walletprovider.ErrOperatorPermission):
		writeError(w, 403, "FORBIDDEN", "Platform Policies permission is required")
	case errors.Is(e, postgres.ErrWalletProviderNotFound):
		writeError(w, 404, "NOT_FOUND", "wallet provider was not found")
	case errors.Is(e, postgres.ErrWalletProviderExists):
		writeError(w, 409, "WALLET_PROVIDER_EXISTS", "wallet provider key already exists")
	case errors.Is(e, postgres.ErrWalletProviderVersion):
		writeError(w, 409, "VERSION_CONFLICT", "wallet provider version is stale")
	case errors.Is(e, postgres.ErrWalletProviderIdempotency):
		writeError(w, 409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different provider facts")
	default:
		var ie *identityclient.Error
		if errors.As(e, &ie) {
			writeIdentityError(w, e)
			return
		}
		writeError(w, 502, "DSH_STORAGE_UNAVAILABLE", "DSH persistence or Identity is unavailable")
	}
}
