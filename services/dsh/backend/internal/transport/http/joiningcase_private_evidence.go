package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
)

func (s *JoiningCaseServer) uploadPartnerJoiningCaseProofImage(w http.ResponseWriter, r *http.Request) {
	if bearerToken(r) == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "an authenticated Partner session is required")
		return
	}
	correlation, idempotency, expected, ok := requiredPartnerCaseHeaders(w, r)
	if !ok {
		return
	}
	data, contentType, ok := readJoiningCaseProofImageUpload(w, r)
	if !ok {
		return
	}
	result, err := s.service.UploadProofImageForPartner(r.Context(), bearerToken(r), r.PathValue("caseId"), idempotency, correlation, expected, contentType, data)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, responseStatus(result.Replayed), result)
}

func (s *JoiningCaseServer) uploadOperatorJoiningCaseProofImage(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	data, contentType, ok := readJoiningCaseProofImageUpload(w, r)
	if !ok {
		return
	}
	result, err := s.service.UploadProofImageForOperator(r.Context(), r.PathValue("caseId"), acting, idempotency, correlation, expected, contentType, data)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	s.writeResult(w, r, responseStatus(result.Replayed), result)
}

func (s *JoiningCaseServer) readJoiningCaseProofDetails(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	if acting == "" || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID and X-Correlation-ID are required")
		return
	}
	details, err := s.service.ReadProofDetailsForOperator(r.Context(), r.PathValue("caseId"), acting, correlation)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	writeJSON(w, http.StatusOK, contract.JoiningCaseProofDetailsResponse{
		JoiningCaseID:         details.CaseID,
		ProofType:             contract.JoiningCaseProofType(details.ProofType),
		ProofNumber:           details.ProofNumber,
		ProofImageUploaded:    details.ImageUploaded,
		ProofImageContentType: details.ImageContentType,
		ProofImageByteSize:    nullableIntPointer(details.ImageByteSize),
	})
}

func (s *JoiningCaseServer) downloadJoiningCaseProofImage(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	if acting == "" || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID and X-Correlation-ID are required")
		return
	}
	image, err := s.service.DownloadProofImageForOperator(r.Context(), r.PathValue("caseId"), acting, correlation)
	if err != nil {
		writeJoiningCaseError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", image.ContentType)
	w.Header().Set("Content-Disposition", "attachment; filename=joining-case-proof")
	w.Header().Set("Content-Length", strconv.Itoa(len(image.Data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(image.Data)
}

func readJoiningCaseProofImageUpload(w http.ResponseWriter, r *http.Request) ([]byte, string, bool) {
	return readMultipartImageUpload(w, r, "a valid private proof image upload is required")
}

func nullableIntPointer(value int64) *int {
	if value < 1 {
		return nil
	}
	converted := int(value)
	return &converted
}
