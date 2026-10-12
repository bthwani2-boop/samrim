package transporthttp

import (
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
	"net/http"
)

func (s *HRServer) listAttendance(w http.ResponseWriter, r *http.Request) {
	_, ok := s.authorize(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	result, err := hr.ListAttendance(r.Context(), s.db, r.PathValue("employeeId"), q.Get("from"), q.Get("to"))
	if err != nil {
		writeHRError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}
func (s *HRServer) recordAttendance(w http.ResponseWriter, r *http.Request) {
	acting, ok := s.authorize(w, r)
	if !ok {
		return
	}
	_, correlation, key, valid := requiredMutationHeaders(w, r)
	if !valid {
		return
	}
	var input hr.AttendanceInput
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := hr.RecordAttendance(r.Context(), s.db, r.PathValue("employeeId"), input, acting, correlation, key)
	if err != nil {
		writeHRError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}
