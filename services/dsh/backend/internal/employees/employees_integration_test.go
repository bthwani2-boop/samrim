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
	"time"

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
		roles := map[string]string{"Bearer hr-current": "operator", "Bearer no-hr": "operator", "Bearer merchant": "merchant", "Bearer merchant-a": "merchant", "Bearer merchant-b": "merchant"}
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
	// Prove the audit scope against an actual other-employer event, not just an absent event.
	if _, err = readback.ExecContext(t.Context(), `INSERT INTO `+schema+`.employee_registration_audit
		(employer_kind,employer_id,employee_id,acting_actor_id,operation_id,request_hash)
		VALUES ('MERCHANT','merchant-a',$1,'merchant-author','00000000-0000-0000-0000-000000000002',decode(repeat('00',32),'hex'))`, merchantID); err != nil {
		t.Fatal(err)
	}
	auditPath := root + "/" + id + "/registration-audit"
	audit := expect("GET", auditPath, "hr-current", "", 200)
	var event registrationEvent
	var recorded time.Time
	if err = readback.QueryRowContext(t.Context(), `SELECT recorded_at FROM `+schema+`.employee_registration_audit WHERE employee_id=$1`, id).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal(audit.Body.Bytes(), &event) != nil || event.EmployeeID != id || event.RegisteredByActorID != "hr-current" ||
		event.RecordedAt != recorded.UTC().Format(time.RFC3339Nano) || strings.Contains(audit.Body.String(), "requestHash") ||
		strings.Contains(audit.Body.String(), "operationId") {
		t.Fatalf("invalid registration audit readback: %s", audit.Body)
	}
	expect("GET", auditPath+"?employerId=merchant-a", "hr-current", "", 400)
	expect("GET", auditPath, "hr-current", "unexpected body", 400)
	expect("GET", auditPath, "", "", 401)
	expect("GET", auditPath, "no-hr", "", 403)
	expect("GET", auditPath, "merchant", "", 403)
	expect("GET", root+"/"+merchantID+"/registration-audit", "hr-current", "", 404)
	expect("GET", root+"/00000000-0000-0000-0000-000000000003/registration-audit", "hr-current", "", 404)
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
		{"audit session revoked", auditPath, false, 401},
		{"audit HR grant revoked", auditPath, true, 403},
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
				strings.Contains(response.Body.String(), "موظف تجريبي") ||
				strings.Contains(response.Body.String(), "registeredByActorId") {
				t.Fatalf("revoked read leaked owner data: status=%d calls=%d body=%s",
					response.Code, transition.calls.Load(), response.Body.String())
			}
		})
	}
	// The same canonical employee engine now admits the individual merchant
	// proprietor, but never a delegated staff account or another owner.
	for _, query := range []string{
		"INSERT INTO " + schema + ".service_cities(id,active) VALUES ('sanaa',true)",
		"INSERT INTO " + schema + ".verticals(id,active) VALUES ('grocery',true)",
		"INSERT INTO " + schema + ".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES " +
			"('staff-store-a','merchant-a','sanaa','grocery','MARKETPLACE','A',false)," +
			"('staff-store-a2','merchant-a','sanaa','grocery','DIRECT','A2',false)," +
			"('staff-store-b','merchant-b','sanaa','grocery','DIRECT','B',false)",
	} {
		if _, err = readback.ExecContext(t.Context(), query); err != nil {
			t.Fatal(err)
		}
	}
	const aRoot = "/v1/stores/staff-store-a/employees"
	const a2Root = "/v1/stores/staff-store-a2/employees"
	const bRoot = "/v1/stores/staff-store-b/employees"
	expect("GET", aRoot, "", "", 401)
	expect("GET", aRoot, "hr-current", "", 403)
	expect("GET", aRoot, "merchant", "", 403)
	expect("GET", aRoot, "merchant-b", "", 403)
	expect("GET", aRoot+"?employerId=merchant-b", "merchant-a", "", 400)
	expect("GET", aRoot+"/"+id, "merchant-a", "", 404)
	expect("GET", bRoot+"/"+merchantID, "merchant-b", "", 404)
	expect("GET", aRoot+"/"+merchantID, "merchant-a", "", 200)
	expect("GET", aRoot+"/"+merchantID+"/registration-audit", "merchant-a", "", 200)
	expect("GET", bRoot+"/"+merchantID+"/registration-audit", "merchant-b", "", 404)
	expect("POST", bRoot, "merchant-a", data, 403)
	expect("POST", aRoot, "merchant-a", strings.Replace(data, "{", `{"employerId":"merchant-b",`, 1), 400)

	// The same operation ID remains scoped by employer and actor, even when
	// the proprietor reopens the directory using a second owned Store.
	merchantPost := strings.Replace(data, "موظف تجريبي", "موظف المتجر", 1)
	var firstID map[string]string
	if err = json.Unmarshal(expect("POST", aRoot, "merchant-a", merchantPost, 200).Body.Bytes(), &firstID); err != nil {
		t.Fatal(err)
	}
	created := firstID["id"]
	if !recordID.MatchString(created) || created == id || created == merchantID {
		t.Fatal("invalid merchant registration ID")
	}
	if err = json.Unmarshal(expect("POST", a2Root, "merchant-a", merchantPost, 200).Body.Bytes(), &firstID); err != nil || firstID["id"] != created {
		t.Fatal("replay across owned stores created another employee")
	}
	expect("POST", aRoot, "merchant-a", strings.Replace(merchantPost, "منسق", "مشرف", 1), 409)
	expect("GET", a2Root+"/"+created, "merchant-a", "", 200)
	expect("GET", bRoot+"/"+created, "merchant-b", "", 404)
	expect("GET", root+"/"+created, "hr-current", "", 404)
	var count, auditCount int
	if err = readback.QueryRowContext(t.Context(), "SELECT count(*) FROM "+schema+".employees WHERE employer_kind='MERCHANT' AND employer_id='merchant-a' AND id=$1", created).Scan(&count); err != nil || count != 1 {
		t.Fatalf("merchant record readback %d: %v", count, err)
	}
	if err = readback.QueryRowContext(t.Context(), "SELECT count(*) FROM "+schema+".employee_registration_audit WHERE employer_kind='MERCHANT' AND employer_id='merchant-a' AND acting_actor_id='merchant-a' AND employee_id=$1", created).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("merchant audit readback %d: %v", auditCount, err)
	}
	var bCreated map[string]string
	if err = json.Unmarshal(expect("POST", bRoot, "merchant-b", merchantPost, 200).Body.Bytes(), &bCreated); err != nil || bCreated["id"] == created {
		t.Fatal("different employer did not receive independent ID")
	}
	expect("GET", aRoot+"/"+bCreated["id"], "merchant-a", "", 404)
	expect("GET", bRoot+"/"+bCreated["id"], "merchant-b", "", 200)

	// A revocation before the owner commit must roll back both the
	// employment record and immutable registration audit.
	revokedData := strings.Replace(merchantPost, "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000099", 1)
	revokedWrite := &merchantEmployeeWriteTransition{}
	revokedHandler, e := NewHandler(t.Context(), db, schema, revokedWrite)
	if e != nil {
		t.Fatal(e)
	}
	writeReq := httptest.NewRequest(http.MethodPost, aRoot, strings.NewReader(revokedData))
	writeReq.Header.Set("Authorization", "Bearer synthetic")
	writeReq.Header.Set("Content-Type", "application/json")
	writeResp := httptest.NewRecorder()
	revokedHandler.ServeHTTP(writeResp, writeReq)
	if writeResp.Code != 401 || revokedWrite.calls.Load() != 3 {
		t.Fatalf("revoked write: %d %s", writeResp.Code, writeResp.Body)
	}
	if err = readback.QueryRowContext(t.Context(), "SELECT count(*) FROM "+schema+".employee_registration_audit WHERE employer_kind='MERCHANT' AND employer_id='merchant-a' AND operation_id='00000000-0000-0000-0000-000000000099'").Scan(&auditCount); err != nil || auditCount != 0 {
		t.Fatalf("revoked write audit persisted: %d %v", auditCount, err)
	}
	if err = readback.QueryRowContext(t.Context(), "SELECT count(*) FROM "+schema+".employees WHERE employer_kind='MERCHANT' AND employer_id='merchant-a'").Scan(&count); err != nil || count != 2 {
		t.Fatalf("revoked write employee persisted: %d %v", count, err)
	}

	// An ownership change during a read must suppress the earlier result.
	transition := &merchantEmployeeReadTransition{
		afterRead: func() error {
			_, e := readback.ExecContext(t.Context(), "UPDATE "+schema+".stores SET owner_actor_id='merchant-b' WHERE id='staff-store-a'")
			return e
		},
	}
	transitionHandler, e := NewHandler(t.Context(), db, schema, transition)
	if e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest(http.MethodGet, aRoot+"/"+created, nil)
	req.Header.Set("Authorization", "Bearer synthetic")
	response := httptest.NewRecorder()
	transitionHandler.ServeHTTP(response, req)
	if response.Code != 403 || strings.Contains(response.Body.String(), "موظف المتجر") {
		t.Fatalf("ownership change disclosed prior data: %d %s", response.Code, response.Body)
	}
	expect("GET", aRoot, "merchant-a", "", 403)
	expect("GET", a2Root+"/"+created, "merchant-a", "", 200)
	expect("GET", aRoot+"/"+created, "merchant-b", "", 404)

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

type merchantEmployeeReadTransition struct {
	calls     atomic.Int32
	afterRead func() error
}

func (i *merchantEmployeeReadTransition) ResolveCurrentSession(context.Context, string) (identityaccess.VerifiedActor, error) {
	if i.calls.Add(1) == 2 {
		if err := i.afterRead(); err != nil {
			return identityaccess.VerifiedActor{}, err
		}
	}
	return identityaccess.VerifiedActor{Subject: "merchant-a", Role: identityaccess.MerchantRole}, nil
}

func (*merchantEmployeeReadTransition) RequireOperatorPermission(context.Context, string, string, string) error {
	return identityaccess.ErrForbidden
}

type merchantEmployeeWriteTransition struct{ calls atomic.Int32 }

func (i *merchantEmployeeWriteTransition) ResolveCurrentSession(context.Context, string) (identityaccess.VerifiedActor, error) {
	if i.calls.Add(1) >= 3 {
		return identityaccess.VerifiedActor{}, identityaccess.ErrUnauthorized
	}
	return identityaccess.VerifiedActor{Subject: "merchant-a", Role: identityaccess.MerchantRole}, nil
}
func (*merchantEmployeeWriteTransition) RequireOperatorPermission(context.Context, string, string, string) error {
	return identityaccess.ErrForbidden
}
