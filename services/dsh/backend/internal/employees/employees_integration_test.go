package employees

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/discovery"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

func TestCompanyEmployeeDirectoryPostgres(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" || os.Getenv("DSH_EMPLOYEES_TEST") != "true" {
		t.Skip("requires explicitly isolated DSH PostgreSQL")
	}
	if os.Getenv("DSH_DB_HOST") != "127.0.0.1" || os.Getenv("REF_POSTGRES_DB") != "bthwani_refoundation" {
		t.Fatal("requires the isolated loopback DSH database")
	}
	db, err := discovery.OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	suffix := make([]byte, 5)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatal(err)
	}
	schema := "dsh_test_employees_" + hex.EncodeToString(suffix)
	owner, err := discovery.New(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	if err := owner.BootstrapFresh(t.Context(), filepath.Join("..", "..", "..", "database", "schema")); err != nil {
		t.Fatal(err)
	}
	var revoked atomic.Bool
	identityOwner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		token := r.Header.Get("Authorization")
		roles := map[string]string{"Bearer hr-current": "operator", "Bearer no-hr": "operator", "Bearer merchant": "merchant"}
		role := roles[token]
		if role == "" || (token == "Bearer hr-current" && revoked.Load()) {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/v1/sessions/current":
			_ = json.NewEncoder(w).Encode(map[string]string{"actorId": token[7:], "role": role, "sessionExpiresAt": "2099-01-01T00:00:00Z"})
		case "/v1/operators/me/permissions/hr":
			if token != "Bearer hr-current" {
				w.WriteHeader(403)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"actorId": "hr-current", "permission": "hr"})
		default:
			w.WriteHeader(404)
		}
	}))
	defer identityOwner.Close()
	identity, err := identityaccess.NewIdentitySessionHTTP(identityOwner.URL)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewHandler(t.Context(), db, schema, identity)
	if err != nil {
		t.Fatal(err)
	}
	const root = "/v1/operators/employees"
	const data = `{"operationId":"00000000-0000-0000-0000-000000000001","displayName":"موظف تجريبي","department":"عمليات","jobTitle":"منسق","startDate":"2026-11-22"}`
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	expect := func(method, path, token, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := request(method, path, token, body)
		if w.Code != status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, w.Code, status, w.Body)
		}
		return w
	}
	expect("GET", root, "", "", 401)
	expect("POST", root, "no-hr", data, 403)
	expect("GET", root, "merchant", "", 403)
	expect("GET", root+"?employerId=merchant-a", "hr-current", "", 400)
	expect("POST", root, "hr-current", strings.Replace(data, "2026-11-22", "2026-02-30", 1), 400)
	expect("POST", root, "hr-current", strings.Replace(data, "{", `{"employerId":"merchant-a",`, 1), 400)
	empty := expect("GET", root, "hr-current", "", 200)
	if strings.TrimSpace(empty.Body.String()) != `{"items":[],"nextCursor":null}` {
		t.Fatalf("expected the persisted empty state: %s", empty.Body)
	}
	const retries = 8
	var group sync.WaitGroup
	responses := make(chan *httptest.ResponseRecorder, retries)
	for range retries {
		group.Go(func() { responses <- request("POST", root, "hr-current", data) })
	}
	group.Wait()
	close(responses)
	var id string
	for response := range responses {
		var confirmation map[string]string
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &confirmation) != nil || !recordID.MatchString(confirmation["id"]) {
			t.Fatalf("registration was not confirmed: %d %s", response.Code, response.Body)
		}
		if id != "" && confirmation["id"] != id {
			t.Fatal("concurrent replay registered a second employee")
		}
		id = confirmation["id"]
	}
	expect("POST", root, "hr-current", strings.Replace(data, "منسق", "مشرف", 1), 409)

	// Independent readback and two additional employer scopes in the disposable schema.
	readback, err := discovery.OpenFromEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	defer readback.Close()
	var records, audits int
	if err := readback.QueryRowContext(t.Context(), `SELECT
		(SELECT count(*) FROM `+schema+`.employees),
		(SELECT count(*) FROM `+schema+`.employee_registration_audit WHERE employee_id=$1 AND acting_actor_id='hr-current')`,
		id).Scan(&records, &audits); err != nil || records != 1 || audits != 1 {
		t.Fatalf("durable records=%d audits=%d: %v", records, audits, err)
	}
	if _, err := readback.ExecContext(t.Context(), "UPDATE "+schema+".employee_registration_audit SET recorded_at=now() WHERE employee_id=$1", id); err == nil {
		t.Fatal("registration audit was mutable")
	}
	const merchantID = "00000000-0000-0000-0000-000000000002"
	_, err = readback.ExecContext(t.Context(), `INSERT INTO `+schema+`.employees
		(id, employer_kind, employer_id, display_name, department, job_title, start_date)
		VALUES ($1,'MERCHANT','merchant-a','Other organization','Support','Staff','2026-01-01'),
		       ('00000000-0000-0000-0000-000000000003','COMPANY','other-company','Other company','Support','Staff','2026-01-01')`, merchantID)
	if err != nil {
		t.Fatal(err)
	}
	expect("GET", root+"/"+merchantID, "hr-current", "", 404)
	expect("GET", root+"/00000000-0000-0000-0000-000000000003", "hr-current", "", 404)
	detail := expect("GET", root+"/"+id, "hr-current", "", 200)
	var record employee
	if json.Unmarshal(detail.Body.Bytes(), &record) != nil || record.ID != id || record.JobTitle != "منسق" {
		t.Fatalf("incorrect employee owner readback: %s", detail.Body)
	}
	list := expect("GET", root, "hr-current", "", 200)
	var shown page
	if json.Unmarshal(list.Body.Bytes(), &shown) != nil || len(shown.Items) != 1 || shown.Items[0].ID != id {
		t.Fatalf("company list was not scoped: %s", list.Body)
	}
	// Identity may revoke a session or HR grant while the real PostgreSQL
	// list/detail query is in progress. Never disclose its completed result.
	for _, tc := range []struct {
		name         string
		path         string
		grantRevoked bool
		want         int
	}{
		{"list session revoked", root, false, 401},
		{"detail session revoked", root + "/" + id, false, 401},
		{"list HR grant revoked", root, true, 403},
		{"detail HR grant revoked", root + "/" + id, true, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transition := &employeeReadTransition{grantRevoked: tc.grantRevoked}
			protected, err := NewHandler(t.Context(), db, schema, transition)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodGet, tc.path, nil)
			request.Header.Set("Authorization", "Bearer hr-current")
			response := httptest.NewRecorder()
			protected.ServeHTTP(response, request)
			if response.Code != tc.want || transition.calls.Load() != 2 ||
				strings.Contains(response.Body.String(), "موظف تجريبي") {
				t.Fatalf("revoked read leaked owner data: status=%d calls=%d body=%s",
					response.Code, transition.calls.Load(), response.Body.String())
			}
		})
	}
	revoked.Store(true)
	expect("GET", root+"/"+id, "hr-current", "", 401)
	expect("POST", root, "hr-current", data, 401)
}

// The first session and permission check passes; the second decision changes
// only after the DSH owner has completed its read.
type employeeReadTransition struct {
	calls        atomic.Int32
	grantRevoked bool
}

func (identity *employeeReadTransition) ResolveCurrentSession(_ context.Context, _ string) (identityaccess.VerifiedActor, error) {
	if identity.calls.Add(1) > 1 && !identity.grantRevoked {
		return identityaccess.VerifiedActor{}, identityaccess.ErrUnauthorized
	}
	return identityaccess.VerifiedActor{Subject: "hr-current", Role: identityaccess.OperatorRole}, nil
}

func (identity *employeeReadTransition) RequireOperatorPermission(_ context.Context, _, _, _ string) error {
	if identity.grantRevoked && identity.calls.Load() > 1 {
		return identityaccess.ErrForbidden
	}
	return nil
}
