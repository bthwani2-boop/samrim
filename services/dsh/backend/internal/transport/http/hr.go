package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
)

type HRServer struct {
	auth     *auth.ServiceToken
	identity *identityintegration.Client
	db       *sql.DB
}

func NewHR(identity *identityintegration.Client, serviceToken string, db *sql.DB) (*HRServer, error) {
	authorization, err := auth.NewServiceToken(serviceToken)
	if err != nil {
		return nil, err
	}
	if db == nil || identity == nil {
		return nil, errors.New("HR dependencies are missing")
	}
	return &HRServer{auth: authorization, identity: identity, db: db}, nil
}
func (s *HRServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/hr/employees", s.listEmployees)
	mux.HandleFunc("POST /dsh/hr/employees", s.createEmployee)
	mux.HandleFunc("GET /dsh/hr/employees/by-actor/{actorId}", s.readEmployeeByOperatorActor)
	mux.HandleFunc("GET /dsh/hr/employees/{employeeId}", s.readEmployee)
	mux.HandleFunc("PATCH /dsh/hr/employees/{employeeId}", s.updateEmployee)
	mux.HandleFunc("POST /dsh/hr/employees/{employeeId}/employment-status", s.setEmploymentStatus)
	s.registerAccessRequests(mux)
}
func (s *HRServer) authorize(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication required")
		return "", false
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "valid operator identity required")
		return "", false
	}
	role, err := s.identity.ReadActorRole(r.Context(), acting, "operator")
	if err != nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "active operator required")
		return "", false
	}
	if role.Role != "operator" || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "active operator required")
		return "", false
	}
	if err = s.identity.RequireOperatorPermission(r.Context(), acting, "hr"); err != nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "HR permission required")
		return "", false
	}
	return acting, true
}

// A separate Root authorization via the Identity canonical administrator check.
func (s *HRServer) authorizeRoot(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !s.auth.Authorized(r) {
		writeError(w, 401, "UNAUTHENTICATED", "service authentication required")
		return "", false
	}
	actor := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actor == "" || len(actor) > 128 {
		writeError(w, 400, "INVALID_INPUT", "operator identity required")
		return "", false
	}
	if err := s.identity.RequireOperatorProfileAdministrator(r.Context(), actor); err != nil {
		writeError(w, 403, "FORBIDDEN", "initial operator authorization required")
		return "", false
	}
	return actor, true
}
func writeHRError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, hr.ErrInvalid):
		writeError(w, 400, "INVALID_INPUT", "invalid employee data")
	case errors.Is(err, hr.ErrConflict):
		writeError(w, 409, "CONFLICT", "employee already exists or request conflict")
	case errors.Is(err, hr.ErrNotFound):
		writeError(w, 404, "NOT_FOUND", "employee not found")
	default:
		writeError(w, 502, "STORAGE_UNAVAILABLE", "employee records unavailable")
	}
}
func (s *HRServer) createEmployee(w http.ResponseWriter, r *http.Request) {
	acting, ok := s.authorize(w, r)
	if !ok {
		return
	}
	_, correlation, key, valid := requiredMutationHeaders(w, r)
	if !valid {
		return
	}
	var input hr.CreateInput
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := hr.Create(r.Context(), s.db, input, acting, correlation, key)
	if err != nil {
		writeHRError(w, err)
		return
	}
	status := http.StatusCreated
	if result.IdempotentReplay {
		status = http.StatusOK
	}
	writeJSON(w, status, result)
}
func (s *HRServer) listEmployees(w http.ResponseWriter, r *http.Request) {
	_, ok := s.authorize(w, r)
	if !ok {
		return
	}
	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		num, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, 400, "INVALID_INPUT", "invalid page size")
			return
		}
		limit = num
	}
	page, err := hr.List(r.Context(), s.db, r.URL.Query().Get("q"), r.URL.Query().Get("cursor"), limit)
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, 200, page)
}
func (s *HRServer) readEmployee(w http.ResponseWriter, r *http.Request) {
	_, ok := s.authorize(w, r)
	if !ok {
		return
	}
	employee, err := hr.Read(r.Context(), s.db, r.PathValue("employeeId"))
	if err != nil {
		writeHRError(w, err)
		return
	}
	writeJSON(w, 200, struct {
		Employee hr.Employee `json:"employee"`
	}{employee})
}
