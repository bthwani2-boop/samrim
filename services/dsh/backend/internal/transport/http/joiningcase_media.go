package transporthttp

import (
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
)

func (s *JoiningCaseServer) uploadStoreProfileImage(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an authenticated Field or Partner session is required")
		return
	}
	correlation, idempotency, expected, ok := requiredPartnerCaseHeaders(w, r)
	if !ok {
		return
	}
	data, contentType, provenance, ok := readStoreProfileImageUpload(w, r)
	if !ok {
		return
	}
	result, err := s.service.UploadStoreProfileImage(r.Context(), bearerToken(r), r.PathValue("caseId"), idempotency, correlation, expected, contentType, data, provenance)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, responseStatus(result.Replayed), result)
}

func (s *JoiningCaseServer) uploadOperatorStoreProfileImage(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	if r.Header.Get("X-Actor-ID") != "" || r.Header.Get("If-Match") != "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "client actor authority headers are forbidden")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	data, contentType, provenance, ok := readStoreProfileImageUpload(w, r)
	if !ok {
		return
	}
	result, err := s.service.UploadStoreProfileImageForOperator(r.Context(), r.PathValue("caseId"), acting, idempotency, correlation, expected, contentType, data, provenance)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, responseStatus(result.Replayed), result)
}

func readStoreProfileImageUpload(w http.ResponseWriter, r *http.Request) ([]byte, string, media.Provenance, bool) {
	data, contentType, ok := readMultipartImageUpload(w, r, "a valid image upload is required")
	if !ok {
		return nil, "", media.Provenance{}, false
	}
	provenance := media.Provenance{
		Creator:           strings.TrimSpace(r.FormValue("creator")),
		SourceDescription: strings.TrimSpace(r.FormValue("sourceDescription")),
		SourceURI:         strings.TrimSpace(r.FormValue("sourceUri")),
		RightsStatement:   strings.TrimSpace(r.FormValue("rightsStatement")),
		RightsURI:         strings.TrimSpace(r.FormValue("rightsUri")),
		RightsAttested:    strings.EqualFold(strings.TrimSpace(r.FormValue("rightsAttested")), "true"),
	}
	if provenance.Validate() != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "creator, source, usage rights and explicit confirmation are required")
		return nil, "", media.Provenance{}, false
	}
	return data, contentType, provenance, true
}
