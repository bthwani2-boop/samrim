package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
	"net/http"
)

func (s *HRServer) updateEmployee(w http.ResponseWriter, r *http.Request) {
	acting, ok := s.authorize(w, r)
	if !ok {
		return
	}
	_, correlation, key, valid := requiredMutationHeaders(w, r)
	if !valid {
		return
	}
	var input hr.UpdateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := hr.Update(r.Context(), s.db, r.PathValue("employeeId"), input, acting, correlation, key)
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
