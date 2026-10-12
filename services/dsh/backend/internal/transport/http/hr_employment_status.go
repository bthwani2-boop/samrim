package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
	"net/http"
	"strconv"
)

// Employment is always an HR record. Identity owns the optional operator role.
// A linked employee may become inactive only after Identity has disabled that role.
func (s *HRServer) setEmploymentStatus(w http.ResponseWriter, r *http.Request) {
	acting, ok := s.authorize(w, r)
	if !ok {
		return
	}
	_, corr, idem, valid := requiredMutationHeaders(w, r)
	if !valid {
		return
	}
	id := r.PathValue("employeeId")
	current, err := hr.Read(r.Context(), s.db, id)
	if err != nil {
		writeHRError(w, err)
		return
	}
	if current.OperatorActorID != nil {
		acting, ok = s.authorizeRoot(w, r)
		if !ok {
			return
		}
	}
	var input hr.EmploymentStatusInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if current.OperatorActorID != nil && input.Status == "inactive" {
		role, err := s.identity.ReadActorRole(r.Context(), *current.OperatorActorID, "operator")
		if err != nil {
			writeError(w, 502, "IDENTITY_UNAVAILABLE", "cannot confirm operator access is disabled")
			return
		}
		if role.Enabled {
			writeError(w, 409, "OPERATOR_ACCESS_ACTIVE", "disable Identity operator access before changing employment status")
			return
		}
	}
	result, err := hr.SetEmploymentStatus(r.Context(), s.db, id, input, acting, corr, idem)
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, 200, result)
}

func (s *HRServer) listEmployeeEvents(w http.ResponseWriter, r *http.Request) {
	_, ok := s.authorize(w, r)
	if !ok {
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, 400, "INVALID_INPUT", "invalid limit")
			return
		}
		limit = n
	}
	page, err := hr.ListEmployeeEvents(r.Context(), s.db, r.PathValue("employeeId"), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, 200, page)
}
func (s *HRServer) readEmployeeByOperatorActor(w http.ResponseWriter, r *http.Request) {
	_, ok := s.authorizeRoot(w, r)
	if !ok {
		return
	}
	employee, err := hr.ReadByOperatorActor(r.Context(), s.db, r.PathValue("actorId"))
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, 200, struct {
		Employee hr.Employee `json:"employee"`
	}{employee})
}
