package transporthttp

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// A merchant can submit for review, but can never write PASSED, publication
// release, or marketplace state. Terms acceptance is explicit per version.
type independentSubmissionRequest struct {
	ExpectedVersion     int    `json:"expectedVersion"`
	HostingTermsVersion string `json:"hostingTermsVersion"`
	TermsAccepted       bool   `json:"termsAccepted"`
}

func (s *StoreAccessServer) submitIndependentPublication(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	if !independentPolicyPrivateRequest(w, r) {
		return
	}
	correlation, key, ok := storeAccessMutationHeaders(w, r)
	if !ok {
		return
	}
	var input independentSubmissionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	approved := strings.TrimSpace(os.Getenv("DSH_APPROVED_INDEPENDENT_HOSTING_TERMS_VERSION"))
	if approved == "" {
		writeError(w, http.StatusConflict, "LEGAL_APPROVAL_REQUIRED", "independent hosting terms have not been approved")
		return
	}
	if !input.TermsAccepted || strings.TrimSpace(input.HostingTermsVersion) != approved {
		writeError(w, http.StatusConflict, "TERMS_VERSION_REQUIRED", "the approved hosting terms must be explicitly accepted")
		return
	}
	result, err := s.service.SubmitIndependentPublicationForOwner(r.Context(), bearerToken(r),
		r.PathValue("storeId"), approved, input.ExpectedVersion, key, correlation)
	if err != nil {
		switch {
		case errors.Is(err, postgres.ErrIndependentPublicationSubmitInvalid):
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "independent submission facts are invalid")
		case errors.Is(err, postgres.ErrIndependentPublicationSubmitVersion), errors.Is(err, postgres.ErrIndependentPublicationSubmitState):
			writeError(w, http.StatusConflict, "VERSION_CONFLICT", "independent publication changed; refresh before retry")
		case errors.Is(err, postgres.ErrIndependentPublicationSubmitReplay):
			writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "the key was used with different independent submission facts")
		case errors.Is(err, postgres.ErrIndependentPublicationSubmitPolicy):
			writeError(w, http.StatusConflict, "POLICY_DRAFT_REQUIRED", "save the Store's customer-facing terms before submitting")
		default:
			writeStoreAccessError(w, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, result)
}
