package transporthttp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"

	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/walletprovider"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type WalletProviderServer struct {
	auth    *auth.ServiceToken
	service *walletprovider.Service
	db      *sql.DB
	media   media.Store
}

func NewWalletProvider(identity *identityintegration.Client, token string, db *sql.DB, mediaStore media.Store) (*WalletProviderServer, error) {
	a, e := auth.NewServiceToken(token)
	if e != nil {
		return nil, e
	}
	s, e := walletprovider.New(identity, db)
	if e != nil {
		return nil, e
	}
	return &WalletProviderServer{auth: a, service: s, db: db, media: mediaStore}, nil
}
func (s *WalletProviderServer) Register(m *http.ServeMux) {
	m.HandleFunc("GET /dsh/public/wallet-providers", s.publicList)
	m.HandleFunc("GET /dsh/wallet-providers", s.list)
	m.HandleFunc("POST /dsh/wallet-providers", s.create)
	m.HandleFunc("PATCH /dsh/wallet-providers/{providerKey}", s.update)
	m.HandleFunc("POST /dsh/wallet-providers/{providerKey}/logo/upload", s.uploadLogo)
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
func (s *WalletProviderServer) uploadLogo(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	actor, corr, idem, version, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	if err := s.service.RequirePolicyOperator(r.Context(), actor); err != nil {
		writeWalletProviderError(w, err)
		return
	}
	if s.media == nil {
		writeError(w, 503, "MEDIA_STORAGE_UNAVAILABLE", "media storage is unavailable")
		return
	}
	upload, ok := parseCatalogMediaUpload(w, r)
	if !ok {
		return
	}
	providerKey := strings.TrimSpace(r.PathValue("providerKey"))
	digest := sha256.Sum256(upload.bytes)
	sha := hex.EncodeToString(digest[:])
	key, err := media.KeyForWalletProviderLogo(providerKey, idem, sha, upload.contentType)
	if err != nil {
		writeError(w, 400, "INVALID_INPUT", "invalid logo metadata")
		return
	}
	uri := s.media.PublicURL(key)
	if uri == "" {
		writeError(w, 503, "MEDIA_STORAGE_UNAVAILABLE", "invalid media public URL")
		return
	}
	input := postgres.WalletProviderLogoInput{ProviderKey: providerKey, ExpectedVersion: version, IdempotencyKey: idem, ActingActorID: actor, CorrelationID: corr, ObjectKey: key, LogoURI: uri, ContentSHA256: sha, ContentType: upload.contentType, Provenance: upload.provenance}
	replay, match, err := postgres.ReadWalletProviderLogoReplay(r.Context(), s.db, input)
	if err != nil {
		writeWalletProviderError(w, err)
		return
	}
	if replay {
		if !match {
			writeWalletProviderError(w, postgres.ErrWalletProviderIdempotency)
			return
		}
		p, e := postgres.ReadWalletProvider(r.Context(), s.db, providerKey)
		if e != nil {
			writeWalletProviderError(w, e)
			return
		}
		writeWalletProviderResult(w, 200, postgres.WalletProviderResult{Provider: p, Replayed: true})
		return
	}
	current, err := postgres.ReadWalletProvider(r.Context(), s.db, providerKey)
	if err != nil {
		writeWalletProviderError(w, err)
		return
	}
	if current.Version != version {
		writeWalletProviderError(w, postgres.ErrWalletProviderVersion)
		return
	}
	if err = s.media.Put(r.Context(), key, bytes.NewReader(upload.bytes), int64(len(upload.bytes)), upload.contentType); err != nil {
		writeError(w, 503, "MEDIA_STORAGE_UNAVAILABLE", "image upload failed")
		return
	}
	result, err := postgres.AttachWalletProviderLogo(r.Context(), s.db, input)
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		latest, e := postgres.ReadWalletProvider(cleanup, s.db, providerKey)
		if e == nil && latest.LogoURI != uri {
			_ = s.media.Delete(cleanup, key)
		}
		cancel()
		writeWalletProviderError(w, err)
		return
	}
	writeWalletProviderResult(w, 200, result)
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
		values = append(values, map[string]any{"key": p.Key, "displayNameAr": p.DisplayNameAr, "active": p.Active, "version": p.Version, "logoUri": p.LogoURI})
	}
	writeJSON(w, 200, map[string]any{"walletProviders": values})
}
func writeWalletProviderResult(w http.ResponseWriter, status int, r postgres.WalletProviderResult) {
	p := r.Provider
	writeJSON(w, status, map[string]any{"walletProvider": map[string]any{"key": p.Key, "displayNameAr": p.DisplayNameAr, "active": p.Active, "version": p.Version, "logoUri": p.LogoURI}, "idempotentReplay": r.Replayed})
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
