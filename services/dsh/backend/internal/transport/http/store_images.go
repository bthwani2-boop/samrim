package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"net/http"
	"strings"
)

func (s *JoiningCaseServer) storeImages(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, 401, "UNAUTHENTICATED", "partner session required")
		return
	}
	s.handleStoreImages(w, r, "")
}
func (s *JoiningCaseServer) operatorStoreImages(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, 401, "UNAUTHENTICATED", "service authentication required")
		return
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" || r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, 400, "INVALID_INPUT", "acting operator required and legacy headers forbidden")
		return
	}
	s.handleStoreImages(w, r, actor)
}
func (s *JoiningCaseServer) handleStoreImages(w http.ResponseWriter, r *http.Request, actor string) {
	store, err := s.service.ReadStoreImages(r.Context(), bearerToken(r), actor, r.PathValue("storeId"))
	if err != nil {
		if err == postgres.ErrStoreNotFound {
			writeError(w, 404, "NOT_FOUND", "store not found")
		} else {
			writeJoiningCaseError(w, err)
		}
		return
	}
	replayed := false
	if r.Method == "POST" {
		var correlation, key string
		var version int
		var ok bool
		if actor != "" {
			_, correlation, key, version, ok = requiredVersionedCaseHeaders(w, r)
		} else {
			correlation, key, version, ok = requiredPartnerCaseHeaders(w, r)
		}
		if !ok {
			return
		}
		data, contentType, provenance, ok := readStoreProfileImageUpload(w, r)
		if !ok {
			return
		}
		store, replayed, err = s.service.UploadStoreOwnedMedia(r.Context(), bearerToken(r), actor, store.ID, r.FormValue("role"), key, correlation, version, contentType, data, provenance)
		if err != nil {
			if err == postgres.ErrStoreNotFound {
				writeError(w, 404, "NOT_FOUND", "store not found")
			} else {
				writeJoiningCaseError(w, err)
			}
			return
		}
	}
	writeJSON(w, 200, contract.StoreImagesResponse{StoreID: store.ID, Version: store.Version, StoreProfileImage: toStoreProfileImage(store.StoreProfileImage), StoreCoverImage: toStoreCoverImage(store.StoreCoverImage), Replayed: replayed})
}
