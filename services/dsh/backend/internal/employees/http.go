package employees

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

type identitySessions interface {
	ResolveCurrentSession(context.Context, string) (identityaccess.VerifiedActor, error)
	RequireOperatorPermission(context.Context, string, string, string) error
}

type employeeReadActorKey struct{}
type employeeDirectoryKey struct{}

var storeIDRule = regexp.MustCompile("^[a-z0-9-]{1,64}$")

func directoryFailure(w http.ResponseWriter, err error, code string) {
	if errors.Is(err, errScope) {
		failure(w, http.StatusForbidden, "EMPLOYEE_SCOPE_FORBIDDEN")
		return
	}
	failure(w, http.StatusServiceUnavailable, code)
}

func verifyReadScope(w http.ResponseWriter, r *http.Request, identity identitySessions, owner directory) bool {
	if !verifyEmployeeReadAuthorization(w, r, identity) {
		return false
	}
	if err := owner.verifyScope(r.Context()); err != nil {
		directoryFailure(w, err, "EMPLOYEE_OWNER_UNAVAILABLE")
		return false
	}
	return true
}

// A successful database read is not authority to disclose the result after
// Identity revokes the session or its HR grant while the query is in flight.
func confirmEmployeeActor(ctx context.Context, r *http.Request, identity identitySessions) error {
	originalActor, ok := r.Context().Value(employeeReadActorKey{}).(string)
	if !ok || originalActor == "" {
		return identityaccess.ErrIdentityUnavailable
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	current, err := identity.ResolveCurrentSession(ctx, token)
	if err != nil {
		return err
	}
	if current.Subject != originalActor {
		return identityaccess.ErrUnauthorized
	}
	if r.PathValue("storeID") != "" {
		if current.Role != identityaccess.MerchantRole {
			return identityaccess.ErrForbidden
		}
		return nil
	}
	if current.Role != identityaccess.OperatorRole {
		return identityaccess.ErrForbidden
	}
	return identity.RequireOperatorPermission(ctx, token, originalActor, "hr")
}

func verifyEmployeeReadAuthorization(w http.ResponseWriter, r *http.Request, identity identitySessions) bool {
	if err := confirmEmployeeActor(r.Context(), r, identity); err != nil {
		identityFailure(w, err)
		return false
	}
	return true
}

func NewHandler(ctx context.Context, db *sql.DB, schema string, identity identitySessions) (http.Handler, error) {
	if db == nil || !isolatedSchema.MatchString(schema) || identity == nil {
		return nil, errors.New("employee directory requires an isolated DSH schema and Identity")
	}
	var ready bool
	err := db.QueryRowContext(ctx, `SELECT pg_catalog.current_database() IN ('bthwani_refoundation',$3)
		AND pg_catalog.to_regclass($1) IS NOT NULL AND pg_catalog.to_regclass($2) IS NOT NULL`,
		schema+".employees", schema+".employee_registration_audit", dbscope.DevelopmentDatabase).Scan(&ready)
	if err != nil || !ready {
		return nil, errors.New("isolated employee directory migration unavailable")
	}
	mux := http.NewServeMux()
	list := func(w http.ResponseWriter, r *http.Request) {
		owner := r.Context().Value(employeeDirectoryKey{}).(directory)
		q, queryErr := url.ParseQuery(r.URL.RawQuery)
		cursor, endState := q.Get("cursor"), q.Get("endState")
		valid := queryErr == nil && (r.URL.RawQuery == "" || strings.Count(r.URL.RawQuery, "&")+1 == len(q))
		for key, values := range q {
			if len(values) != 1 || (key != "cursor" && key != "endState") ||
				(key == "cursor" && !recordID.MatchString(cursor)) ||
				(key == "endState" && endState != "NO_END_DATE" && endState != "HAS_END_DATE") {
				valid = false
			}
		}
		if !valid {
			failure(w, http.StatusBadRequest, "EMPLOYEE_QUERY_INVALID")
			return
		}
		result, err := owner.list(r.Context(), cursor, endState)
		if err != nil {
			directoryFailure(w, err, "EMPLOYEE_OWNER_UNAVAILABLE")
			return
		}
		if !verifyReadScope(w, r, identity, owner) {
			return
		}
		reply(w, http.StatusOK, result)
	}
	detail := func(w http.ResponseWriter, r *http.Request) {
		owner := r.Context().Value(employeeDirectoryKey{}).(directory)
		id := r.PathValue("id")
		if !recordID.MatchString(id) || r.URL.RawQuery != "" {
			failure(w, http.StatusBadRequest, "EMPLOYEE_QUERY_INVALID")
			return
		}
		record, err := owner.get(r.Context(), id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			directoryFailure(w, err, "EMPLOYEE_OWNER_UNAVAILABLE")
			return
		}
		if !verifyReadScope(w, r, identity, owner) {
			return
		}
		if errors.Is(err, sql.ErrNoRows) {
			failure(w, http.StatusNotFound, "EMPLOYEE_NOT_FOUND")
			return
		}
		reply(w, http.StatusOK, record)
	}
	audit := func(w http.ResponseWriter, r *http.Request) {
		owner := r.Context().Value(employeeDirectoryKey{}).(directory)
		id := r.PathValue("id")
		if !recordID.MatchString(id) || r.URL.RawQuery != "" || r.URL.ForceQuery ||
			r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
			failure(w, http.StatusBadRequest, "EMPLOYEE_QUERY_INVALID")
			return
		}
		event, err := owner.registrationAudit(r.Context(), id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			directoryFailure(w, err, "EMPLOYEE_OWNER_UNAVAILABLE")
			return
		}
		if !verifyReadScope(w, r, identity, owner) {
			return
		}
		if errors.Is(err, sql.ErrNoRows) {
			failure(w, http.StatusNotFound, "EMPLOYEE_NOT_FOUND")
			return
		}
		reply(w, http.StatusOK, event)
	}
	// Route matching establishes the Store identifier before authentication.
	// Company and merchant paths share the same directory implementation.
	authorize := func(merchant bool, next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
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
			if strings.TrimSpace(actor.Subject) == "" || len(actor.Subject) > 128 {
				failure(w, http.StatusUnauthorized, "UNAUTHENTICATED")
				return
			}
			scope := employerScope{kind: "COMPANY", id: "bthwani"}
			if merchant {
				storeID := r.PathValue("storeID")
				if actor.Role != identityaccess.MerchantRole {
					failure(w, http.StatusForbidden, "EMPLOYEE_SCOPE_FORBIDDEN")
					return
				}
				if !storeIDRule.MatchString(storeID) {
					failure(w, http.StatusBadRequest, "EMPLOYEE_QUERY_INVALID")
					return
				}
				scope = employerScope{kind: "MERCHANT", id: actor.Subject, storeID: storeID}
			} else {
				if actor.Role != identityaccess.OperatorRole {
					failure(w, http.StatusForbidden, "EMPLOYEE_SCOPE_FORBIDDEN")
					return
				}
				if err = identity.RequireOperatorPermission(r.Context(), token, actor.Subject, "hr"); err != nil {
					identityFailure(w, err)
					return
				}
			}
			owner := directory{db: db, schema: schema, scope: scope}
			ctx := context.WithValue(r.Context(), employeeReadActorKey{}, actor.Subject)
			ctx = context.WithValue(ctx, employeeDirectoryKey{}, owner)
			next(w, r.WithContext(ctx))
		}
	}
	for _, route := range []struct {
		root     string
		merchant bool
	}{
		{"/v1/operators/employees", false},
		{"/v1/stores/{storeID}/employees", true},
	} {
		mux.HandleFunc("GET "+route.root, authorize(route.merchant, list))
		mux.HandleFunc("GET "+route.root+"/{id}", authorize(route.merchant, detail))
		mux.HandleFunc("GET "+route.root+"/{id}/registration-audit", authorize(route.merchant, audit))
		mux.HandleFunc("POST "+route.root, authorize(route.merchant, func(w http.ResponseWriter, r *http.Request) {
			owner := r.Context().Value(employeeDirectoryKey{}).(directory)
			actor := r.Context().Value(employeeReadActorKey{}).(string)
			register(w, r, owner, actor, identity)
		}))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	}), nil
}

func register(w http.ResponseWriter, r *http.Request, owner directory, actorID string, identity identitySessions) {
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
	if !verifyEmployeeReadAuthorization(w, r, identity) {
		return
	}
	id, err := owner.register(r.Context(), actorID, input, func(ctx context.Context) error {
		return confirmEmployeeActor(ctx, r, identity)
	})
	switch {
	case errors.Is(err, identityaccess.ErrUnauthorized), errors.Is(err, identityaccess.ErrForbidden), errors.Is(err, identityaccess.ErrIdentityUnavailable):
		identityFailure(w, err)
	case errors.Is(err, errScope):
		failure(w, http.StatusForbidden, "EMPLOYEE_SCOPE_FORBIDDEN")
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
	case errors.Is(err, identityaccess.ErrUnauthorized):
		failure(w, http.StatusUnauthorized, "UNAUTHENTICATED")
	case errors.Is(err, identityaccess.ErrForbidden):
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
