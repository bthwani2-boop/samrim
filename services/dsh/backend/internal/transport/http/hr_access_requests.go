package transporthttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
)

func (s *HRServer) registerAccessRequests(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/hr/access-requests", s.listAccessRequests)
	mux.HandleFunc("GET /dsh/hr/access-requests/{requestId}", s.readAccessRequest)
	mux.HandleFunc("POST /dsh/hr/access-requests", s.createAccessRequest)
	mux.HandleFunc("POST /dsh/hr/access-requests/{requestId}/link", s.linkAccessRequest)
	mux.HandleFunc("POST /dsh/hr/access-requests/{requestId}/reject", s.rejectAccessRequest)
	mux.HandleFunc("POST /dsh/hr/access-requests/{requestId}/provision", s.provisionAccessRequest)
}
func (s *HRServer) createAccessRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.authorize(w, r)
	if !ok {
		return
	}
	_, corr, idem, valid := requiredMutationHeaders(w, r)
	if !valid {
		return
	}
	var input hr.AccessRequestInput
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := hr.CreateAccessRequest(r.Context(), s.db, input, actor, corr, idem)
	if err != nil {
		writeHRError(w, err)
		return
	}
	status := http.StatusCreated
	if result.IdempotentReplay {
		status = 200
	}
	writeJSON(w, status, result)
}
func (s *HRServer) listAccessRequests(w http.ResponseWriter, r *http.Request) {
	_, ok := s.authorize(w, r)
	if !ok {
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeHRError(w, hr.ErrInvalid)
			return
		}
		limit = parsed
	}
	result, err := hr.ListAccessRequests(r.Context(), s.db, r.URL.Query().Get("employeeId"), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *HRServer) readAccessRequest(w http.ResponseWriter, r *http.Request) {
	_, ok := s.authorize(w, r)
	if !ok {
		return
	}
	result, err := hr.ReadAccessRequest(r.Context(), s.db, r.PathValue("requestId"))
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, 200, struct {
		Request hr.AccessRequest `json:"request"`
	}{result})
}
func (s *HRServer) rejectAccessRequest(w http.ResponseWriter, r *http.Request) {
	s.decideAccessRequest(w, r, "rejected")
}
func (s *HRServer) provisionAccessRequest(w http.ResponseWriter, r *http.Request) {
	s.decideAccessRequest(w, r, "identity_provisioning")
}
func (s *HRServer) decideAccessRequest(w http.ResponseWriter, r *http.Request, action string) {
	actor, ok := s.authorizeRoot(w, r)
	if !ok {
		return
	}
	_, corr, idem, valid := requiredMutationHeaders(w, r)
	if !valid {
		return
	}
	var input struct {
		ExpectedVersion int    `json:"expectedVersion"`
		Reason          string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := hr.DecideAccessRequest(r.Context(), s.db, r.PathValue("requestId"), action, input.Reason, input.ExpectedVersion, actor, corr, idem)
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (s *HRServer) linkAccessRequest(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.authorizeRoot(w, r)
	if !ok {
		return
	}
	_, corr, idem, valid := requiredMutationHeaders(w, r)
	if !valid {
		return
	}
	var input struct {
		OperatorProfileID string `json:"operatorProfileId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	id := r.PathValue("requestId")
	request, err := hr.ReadAccessRequest(r.Context(), s.db, id)
	if err != nil {
		writeHRError(w, err)
		return
	}
	if strings.TrimSpace(input.OperatorProfileID) == "" {
		writeHRError(w, hr.ErrInvalid)
		return
	}
	// This Identity read is exclusively authorized for the initial Operator.
	// A forged service header from an ordinary HR Operator cannot pass it.
	profile, err := s.identity.ReadOperatorProfileForAdministrator(r.Context(), actor, input.OperatorProfileID)
	if err != nil {
		writeError(w, 403, "FORBIDDEN", "initial operator authorization and an existing Identity profile are required")
		return
	}
	if profile.Profile.ID != input.OperatorProfileID ||
		profile.Profile.PhoneE164 == "" || profile.Profile.PhoneE164 != request.PhoneE164 ||
		profile.Profile.FullNameAr != request.EmployeeName || profile.Profile.State != "pending_review" {
		writeError(w, 409, "CONFLICT", "Identity profile does not match this employee request")
		return
	}
	result, err := hr.LinkAccessRequest(r.Context(), s.db, id, input.OperatorProfileID, actor, corr, idem)
	if err != nil {
		writeHRError(w, err)
		return
	}
	status := http.StatusOK
	if result.IdempotentReplay {
		status = 200
	}
	writeJSON(w, status, result)
}
