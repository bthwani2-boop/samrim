package employees

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

type identitySessions interface {
	ResolveCurrentSession(context.Context, string) (storeavailability.VerifiedActor, error)
	RequireOperatorPermission(context.Context, string, string, string) error
}

func NewHandler(ctx context.Context, db *sql.DB, schema string, identity identitySessions) (http.Handler, error) {
	if db == nil || !isolatedSchema.MatchString(schema) || identity == nil {
		return nil, errors.New("employee directory requires an isolated DSH schema and Identity")
	}
	var ready bool
	err := db.QueryRowContext(ctx, `SELECT pg_catalog.current_database()='bthwani_refoundation'
		AND pg_catalog.to_regclass($1) IS NOT NULL AND pg_catalog.to_regclass($2) IS NOT NULL`,
		schema+".employees", schema+".employee_registration_audit").Scan(&ready)
	if err != nil || !ready {
		return nil, errors.New("isolated employee directory migration unavailable")
	}
	owner := directory{db: db, schema: schema}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/operators/employees", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		cursor := q.Get("cursor")
		if r.URL.RawQuery != "" && (r.URL.RawQuery != "cursor="+cursor || !recordID.MatchString(cursor)) {
			failure(w, http.StatusBadRequest, "EMPLOYEE_QUERY_INVALID")
			return
		}
		result, err := owner.list(r.Context(), cursor)
		if err != nil {
			failure(w, http.StatusServiceUnavailable, "EMPLOYEE_OWNER_UNAVAILABLE")
			return
		}
		reply(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /v1/operators/employees/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !recordID.MatchString(id) || r.URL.RawQuery != "" {
			failure(w, http.StatusBadRequest, "EMPLOYEE_QUERY_INVALID")
			return
		}
		record, err := owner.get(r.Context(), id)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			failure(w, http.StatusNotFound, "EMPLOYEE_NOT_FOUND")
		case err != nil:
			failure(w, http.StatusServiceUnavailable, "EMPLOYEE_OWNER_UNAVAILABLE")
		default:
			reply(w, http.StatusOK, record)
		}
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		header := r.Header.Values("Authorization")
		if len(header) != 1 || !strings.HasPrefix(header[0], "Bearer ") {
			failure(w, http.StatusUnauthorized, "UNAUTHENTICATED")
			return
		}
		token := strings.TrimPrefix(header[0], "Bearer ")
		actor, err := identity.ResolveCurrentSession(r.Context(), token)
		if err != nil {
			identityFailure(w, err)
			return
		}
		if actor.Role != storeavailability.OperatorRole {
			failure(w, http.StatusForbidden, "EMPLOYEE_SCOPE_FORBIDDEN")
			return
		}
		if err = identity.RequireOperatorPermission(r.Context(), token, actor.Subject, "hr"); err != nil {
			identityFailure(w, err)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v1/operators/employees" {
			register(w, r, owner, actor.Subject)
			return
		}
		mux.ServeHTTP(w, r)
	}), nil
}

func register(w http.ResponseWriter, r *http.Request, owner directory, actorID string) {
	var input registration
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" || r.URL.RawQuery != "" {
		failure(w, http.StatusBadRequest, "EMPLOYEE_REGISTRATION_INVALID")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
	if err != nil || !utf8.Valid(body) {
		failure(w, http.StatusBadRequest, "EMPLOYEE_REGISTRATION_INVALID")
		return
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF || !input.valid() {
		failure(w, http.StatusBadRequest, "EMPLOYEE_REGISTRATION_INVALID")
		return
	}
	id, err := owner.register(r.Context(), actorID, input)
	switch {
	case errors.Is(err, errConflict):
		failure(w, http.StatusConflict, "EMPLOYEE_OPERATION_REUSED")
	case err != nil:
		failure(w, http.StatusServiceUnavailable, "EMPLOYEE_REGISTRATION_UNCONFIRMED")
	default:
		reply(w, http.StatusOK, map[string]string{"id": id})
	}
}

func (input *registration) valid() bool {
	date, err := time.Parse(time.DateOnly, input.StartDate)
	return recordID.MatchString(input.OperationID) && err == nil && date.Year() >= 1 &&
		normalizeText(&input.DisplayName, 120) && normalizeText(&input.Department, 80) &&
		normalizeText(&input.JobTitle, 80)
}

func normalizeText(value *string, limit int) bool {
	*value = strings.TrimSpace(*value)
	return *value != "" && utf8.RuneCountInString(*value) <= limit &&
		strings.IndexFunc(*value, func(r rune) bool { return unicode.IsControl(r) || r == utf8.RuneError }) == -1
}

func identityFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storeavailability.ErrUnauthorized):
		failure(w, http.StatusUnauthorized, "UNAUTHENTICATED")
	case errors.Is(err, storeavailability.ErrForbidden):
		failure(w, http.StatusForbidden, "EMPLOYEE_SCOPE_FORBIDDEN")
	default:
		failure(w, http.StatusServiceUnavailable, "IDENTITY_OWNER_UNAVAILABLE")
	}
}

func failure(w http.ResponseWriter, status int, code string) {
	reply(w, status, map[string]string{"code": code})
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
