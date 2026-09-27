package transporthttp

import (
	"io"
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
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+(64*1024))
	parseErr := r.ParseMultipartForm(media.MaxUploadBytes)
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if parseErr != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid image upload is required")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil || header == nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a file field is required")
		return
	}
	defer file.Close()
	if header.Size < 1 || header.Size > media.MaxUploadBytes {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "image size must not exceed 10 MiB")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, media.MaxUploadBytes+1))
	if err != nil || int64(len(data)) > media.MaxUploadBytes {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "image size must not exceed 10 MiB")
		return
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
		return
	}
	result, err := s.service.UploadStoreProfileImage(r.Context(), bearerToken(r), r.PathValue("caseId"), idempotency, correlation, expected, header.Header.Get("Content-Type"), data, provenance)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, responseStatus(result.Replayed), result)
}
