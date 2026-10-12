package transporthttp

import (
	"errors"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

// createHRIdentityProfile is the sole trusted new-operator creation path.
// DSH validates the HR request before crossing into Identity; the Identity
// service rejects direct Control Panel profile creation.
func (s *HRServer) createHRIdentityProfile(w http.ResponseWriter, r *http.Request) {
	acting, ok := s.authorizeRoot(w, r)
	if !ok {
		return
	}
	_, correlation, _, valid := requiredMutationHeaders(w, r)
	if !valid {
		return
	}

	requestID := r.PathValue("requestId")
	record, err := hr.ReadAccessRequest(r.Context(), s.db, requestID)
	if err != nil {
		writeHRError(w, err)
		return
	}
	if record.State == "identity_profile_created" && record.OperatorProfileID != "" {
		writeJSON(w, http.StatusOK, struct {
			Request hr.AccessRequest `json:"request"`
		}{record})
		return
	}
	if record.State != "pending_review" && record.State != "identity_provisioning" {
		writeHRError(w, hr.ErrConflict)
		return
	}
	if record.EmployeeName == "" || record.PhoneE164 == "" || record.JobTitle == "" || record.Department == "" {
		writeHRError(w, hr.ErrConflict)
		return
	}
	employee, err := hr.Read(r.Context(), s.db, record.EmployeeID)
	if err != nil {
		writeHRError(w, err)
		return
	}
	if !hr.AccessRequestMatchesEmployee(record, employee) {
		writeHRError(w, hr.ErrConflict)
		return
	}

	if record.State == "pending_review" {
		result, decisionErr := hr.DecideAccessRequest(r.Context(), s.db, requestID,
			"identity_provisioning", "", record.Version, acting, correlation, "hr-provision-"+requestID)
		if decisionErr != nil {
			writeHRError(w, decisionErr)
			return
		}
		record = result.Request
	}

	profile, err := s.identity.CreateOperatorProfileForHR(r.Context(), acting,
		identityclient.OperatorProfileCreateRequest{
			FullNameAr: record.EmployeeName, PhoneE164: record.PhoneE164,
			JobTitle: record.JobTitle, Department: record.Department,
		}, correlation, "hr-profile-"+requestID)
	if err != nil {
		var upstream *identityclient.Error
		if errors.As(err, &upstream) && upstream.Status == http.StatusConflict {
			writeHRError(w, hr.ErrConflict)
		} else {
			writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "operator profile creation is not confirmed")
		}
		return
	}
	if profile.Profile.ID == "" || profile.Profile.State != "pending_review" {
		writeError(w, http.StatusBadGateway, "IDENTITY_MISMATCH", "Identity returned an unexpected profile")
		return
	}
	linked, err := hr.LinkAccessRequest(r.Context(), s.db, requestID, profile.Profile.ID,
		acting, correlation, "hr-link-"+requestID)
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Request hr.AccessRequest `json:"request"`
		Profile struct {
			ID string `json:"id"`
		} `json:"profile"`
	}{linked.Request, struct {
		ID string `json:"id"`
	}{profile.Profile.ID}})
}
