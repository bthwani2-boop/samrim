package storeavailability

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Tests the actual separate Identity process and the DSH HTTP/PostgreSQL owners.
// All identities and Store rows are synthetic. This DOES NOT prove login/issuer,
// browser clients, checkout, WLT or shared/production deployment.
func TestIsolatedRealIdentityAndDshAvailability(t *testing.T) {
	dsn := os.Getenv("BTHWANI_DSH_TEST_DATABASE_URL")
	identityBinary := os.Getenv("BTHWANI_IDENTITY_TEST_BINARY")
	sqlDir := os.Getenv("BTHWANI_IDENTITY_TEST_SQL_DIR")
	if dsn == "" || identityBinary == "" || sqlDir == "" {
		t.Skip("NOT_RUN: dedicated agent02 PostgreSQL and real Identity executable not configured")
	}
	uri, err := url.Parse(dsn)
	if err != nil || uri.Scheme != "postgres" || uri.Host != "127.0.0.1:5432" ||
		uri.User.Username() != "bthwani_agent02" || uri.Path != "/orderability_agent02" ||
		os.Getenv("BTHWANI_DSH_TEST_CONTAINER") != "bthwani-session02-orderability-pg" ||
		identityBinary != "/agent02/bin/identity" ||
		sqlDir != "/agent02/services/identity/database/migrations" {
		t.Fatal("refusing non-agent02 synthetic test environment")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(8)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	var name string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&name); err != nil || name != "orderability_agent02" {
		t.Fatal("refusing non-agent02 PostgreSQL database")
	}

	random := make([]byte, 5)
	if _, err = rand.Read(random); err != nil {
		t.Fatal(err)
	}
	suffix := hex.EncodeToString(random)
	identitySchema := "identity_test_a02_" + suffix
	var preexisting int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM pg_namespace WHERE nspname=$1", identitySchema).Scan(&preexisting); err != nil || preexisting != 0 {
		t.Fatal("Identity synthetic schema must be new")
	}
	for _, f := range []string{"001_session_verification.sql", "002_operator_permission_read.sql", "003_verified_customer_merchant_admission.sql"} {
		source, e := os.ReadFile(filepath.Join(sqlDir, f))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(source), "__SCHEMA__", identitySchema)); e != nil {
			t.Fatalf("Identity migration %s: %v", f, e)
		}
	}
	// Each proof gets a fresh synthetic DSH schema. The actual DSH process
	// intentionally accepts only explicitly opted-in dsh_test_* namespaces.
	dshSchema := "dsh_test_a02_" + suffix
	for _, f := range []string{"001_public_discovery.sql", "002_store_orderability.sql", "003_service_city_timezone.sql", "004_store_availability_city_limits.sql"} {
		source, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", f))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(source), "__SCHEMA__", dshSchema)); e != nil {
			t.Fatalf("DSH migration %s: %v", f, e)
		}
	}

	merchantA, merchantB := "merchant-a-"+suffix, "merchant-b-"+suffix
	customer, operator := "customer-"+suffix, "operator-"+suffix
	for _, actor := range []struct{ id, role string }{{merchantA, "merchant"}, {merchantB, "merchant"}, {customer, "customer"}, {operator, "operator"}} {
		if _, err = db.ExecContext(ctx, "INSERT INTO "+identitySchema+".actors(id,status) VALUES($1,'ACTIVE')", actor.id); err != nil {
			t.Fatal(err)
		}
		if _, err = db.ExecContext(ctx, "INSERT INTO "+identitySchema+".actor_roles(actor_id,role,status) VALUES($1,$2,'ACTIVE')", actor.id, actor.role); err != nil {
			t.Fatal(err)
		}
	}
	// Only the synthetic Identity verifier marks this test Customer verified.
	// Merchant admission must still convey no DSH Store rights by itself.
	if _, err = db.ExecContext(ctx, "UPDATE "+identitySchema+".actors SET verified_at=now() WHERE id=$1", customer); err != nil {
		t.Fatal(err)
	}
	issue := func(actor, role string) (string, []byte) {
		t.Helper()
		secret := make([]byte, 32)
		if _, e := rand.Read(secret); e != nil {
			t.Fatal(e)
		}
		digest := sha256.Sum256(secret)
		if _, e := db.ExecContext(ctx, "INSERT INTO "+identitySchema+".auth_sessions(token_digest,actor_id,role,actor_version,role_version,expires_at) VALUES($1,$2,$3,1,1,$4)", digest[:], actor, role, time.Now().UTC().Add(time.Hour)); e != nil {
			t.Fatal(e)
		}
		return base64.RawURLEncoding.EncodeToString(secret), digest[:]
	}
	tokenA, digestA := issue(merchantA, "merchant")
	tokenB, _ := issue(merchantB, "merchant")
	tokenCustomer, _ := issue(customer, "customer")
	tokenOperator, _ := issue(operator, "operator")
	city := "city-a02-" + suffix
	store := "store-a02-" + suffix
	for _, query := range []string{
		"INSERT INTO " + dshSchema + ".service_cities(id,active,timezone_name) VALUES($1,true,'Asia/Aden')",
	} {
		if _, err = db.ExecContext(ctx, query, city); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+dshSchema+".verticals(id,active) VALUES('grocery',true) ON CONFLICT(id) DO NOTHING"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+dshSchema+".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES($1,$2,$3,'grocery','MARKETPLACE','Synthetic Store',false)", store, merchantA, city); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+dshSchema+".store_operational_limits(city_id,max_pause_seconds,max_preparation_minutes,version,changed_by_actor,change_reason) VALUES($1,3600,90,1,$2,'Isolated test')", city, operator); err != nil {
		t.Fatal(err)
	}

	proc := exec.CommandContext(ctx, identityBinary)
	proc.Env = append(os.Environ(), "BTHWANI_ISOLATED_TEST_MODE=true", "BTHWANI_ISOLATED_CONTAINER_MODE=false", "IDENTITY_DB_SCHEMA="+identitySchema,
		"IDENTITY_TEST_DATABASE_URL="+dsn, "IDENTITY_DEV_LISTEN_ADDR=127.0.0.1:13302")
	var output bytes.Buffer
	proc.Stdout, proc.Stderr = &output, &output
	if err = proc.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = proc.Process.Kill(); _ = proc.Wait() }()
	identityURL := "http://127.0.0.1:13302"
	ready := false
	for start := time.Now(); time.Since(start) < 5*time.Second; {
		r, e := http.NewRequestWithContext(ctx, http.MethodGet, identityURL+"/v1/sessions/current", nil)
		if e != nil {
			t.Fatal(e)
		}
		r.Header.Set("Authorization", "Bearer "+tokenA)
		response, e := (&http.Client{Timeout: 300 * time.Millisecond}).Do(r)
		if e == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				ready = true
				break
			}
		}
		time.Sleep(60 * time.Millisecond)
	}
	if !ready {
		t.Fatal("real Identity process did not verify isolated session; process logs:", output.String())
	}
	identity, err := NewIdentitySessionHTTP(identityURL)
	if err != nil {
		t.Fatal(err)
	}
	grants, err := NewPostgresStoreGrants(db, dshSchema)
	if err != nil {
		t.Fatal(err)
	}
	policies, err := NewPostgresPolicySource(db, dshSchema)
	if err != nil {
		t.Fatal(err)
	}
	repo, err := NewPostgresRepository(db, dshSchema)
	if err != nil {
		t.Fatal(err)
	}
	svc, err := NewService(identity, grants, policies, repo)
	if err != nil {
		t.Fatal(err)
	}
	mux, err := NewHandler(svc)
	if err != nil {
		t.Fatal(err)
	}
	dshServer := httptest.NewServer(mux)
	defer dshServer.Close()
	path := "/v1/stores/" + store + "/availability"
	request := func(method, token string, payload []byte) (int, []byte) {
		t.Helper()
		req, e := http.NewRequestWithContext(ctx, method, dshServer.URL+path, bytes.NewReader(payload))
		if e != nil {
			t.Fatal(e)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if method == http.MethodPatch {
			req.Header.Set("Content-Type", "application/json")
		}
		res, e := dshServer.Client().Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		var body bytes.Buffer
		if _, e = body.ReadFrom(res.Body); e != nil {
			t.Fatal(e)
		}
		return res.StatusCode, body.Bytes()
	}
	for _, tc := range []struct {
		name, token string
		status      int
	}{
		{"owner", tokenA, 200}, {"other merchant", tokenB, 403}, {"customer", tokenCustomer, 403}, {"operator without grant", tokenOperator, 403}, {"unauthenticated", "", 401},
	} {
		status, _ := request(http.MethodGet, tc.token, nil)
		if status != tc.status {
			t.Fatalf("%s GET: got %d want %d", tc.name, status, tc.status)
		}
	}
	opID := "a02-update-" + suffix
	payload, _ := json.Marshal(map[string]any{"operationId": opID, "expectedVersion": int64(1),
		"weekly": []map[string]int{{"weekday": 1, "opens": 600, "closes": 1200}}, "preparationMinutes": 20, "reason": "Synthetic real Identity proof"})
	status, body := request(http.MethodPatch, tokenA, payload)
	if status != 200 || !bytes.Contains(body, []byte("\"version\":2")) || !bytes.Contains(body, []byte("\"replay\":false")) {
		t.Fatalf("real Identity-authorized DSH write failed: status=%d body=%s", status, body)
	}
	status, body = request(http.MethodPatch, tokenA, payload)
	if status != 200 || !bytes.Contains(body, []byte("\"replay\":true")) {
		t.Fatalf("idempotent replay did not reconcile: %d %s", status, body)
	}
	status, _ = request(http.MethodPatch, tokenB, payload)
	if status != 403 {
		t.Fatal("other Store owner bypass:", status)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+identitySchema+".operator_permissions(actor_id,permission) VALUES($1,'operations')", operator); err != nil {
		t.Fatal(err)
	}
	status, _ = request(http.MethodGet, tokenOperator, nil)
	if status != 200 {
		t.Fatalf("current Operator grant denied: %d", status)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+identitySchema+".operator_permissions SET state='REVOKED' WHERE actor_id=$1 AND permission='operations'", operator); err != nil {
		t.Fatal(err)
	}
	status, _ = request(http.MethodGet, tokenOperator, nil)
	if status != 403 {
		t.Fatalf("revoked Operator grant still allowed: %d", status)
	}
	// The current Identity Owner must require an independent platform_policies
	// permission. An operations grant cannot be treated as policy authority,
	// and a platform_policies grant must not resurrect revoked operations.
	if check := identity.RequireOperatorPermission(ctx, tokenOperator, operator, "platform_policies"); !errors.Is(check, ErrForbidden) {
		t.Fatalf("operations grant was accepted as platform policy authority: %v", check)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+identitySchema+".operator_permissions(actor_id,permission) VALUES($1,'platform_policies')", operator); err != nil {
		t.Fatal(err)
	}
	if check := identity.RequireOperatorPermission(ctx, tokenOperator, operator, "platform_policies"); check != nil {
		t.Fatalf("current platform_policies grant was denied by real Identity: %v", check)
	}
	if status, _ := request(http.MethodGet, tokenOperator, nil); status != http.StatusForbidden {
		t.Fatalf("platform_policies grant revived revoked operations scope: %d", status)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+identitySchema+".operator_permissions SET state='REVOKED' WHERE actor_id=$1 AND permission='platform_policies'", operator); err != nil {
		t.Fatal(err)
	}
	if check := identity.RequireOperatorPermission(ctx, tokenOperator, operator, "platform_policies"); !errors.Is(check, ErrForbidden) {
		t.Fatalf("revoked platform_policies grant remained effective: %v", check)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+identitySchema+".auth_sessions SET revoked_at=now() WHERE token_digest=$1", digestA); err != nil {
		t.Fatal(err)
	}
	status, _ = request(http.MethodGet, tokenA, nil)
	if status != 401 {
		t.Fatalf("revoked merchant session still allowed: %d", status)
	}
	var versions, audits, commands int
	if err = db.QueryRowContext(ctx, "SELECT version FROM "+dshSchema+".store_operational_availability WHERE store_id=$1", store).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+dshSchema+".store_operational_audit WHERE store_id=$1", store).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+dshSchema+".store_operational_commands WHERE store_id=$1", store).Scan(&commands); err != nil {
		t.Fatal(err)
	}
	if versions != 2 || audits != 1 || commands != 1 {
		t.Fatalf("durable Store mutation unsafe: version=%d audits=%d commands=%d", versions, audits, commands)
	}
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	var independentVersion, independentAudits, revokedPermissions, revokedPolicyPermissions, revokedSessions int
	if err = independent.QueryRowContext(ctx, "SELECT version FROM "+dshSchema+".store_operational_availability WHERE store_id=$1", store).Scan(&independentVersion); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+dshSchema+".store_operational_audit WHERE store_id=$1", store).Scan(&independentAudits); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+identitySchema+".operator_permissions WHERE actor_id=$1 AND permission='operations' AND state='REVOKED'", operator).Scan(&revokedPermissions); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+identitySchema+".operator_permissions WHERE actor_id=$1 AND permission='platform_policies' AND state='REVOKED'", operator).Scan(&revokedPolicyPermissions); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+identitySchema+".auth_sessions WHERE token_digest=$1 AND revoked_at IS NOT NULL", digestA).Scan(&revokedSessions); err != nil {
		t.Fatal(err)
	}
	if independentVersion != 2 || independentAudits != 1 || revokedPermissions != 1 || revokedPolicyPermissions != 1 || revokedSessions != 1 {
		t.Fatalf("independent durable readback mismatch: version=%d audits=%d revokedGrants=%d revokedSessions=%d",
			independentVersion, independentAudits, revokedPermissions, revokedSessions)
	}
	// Use Identity's actual one-time Customer-to-Merchant issuer, not a
	// test-manufactured Merchant token. Role admission must not mint DSH
	// Store authority; only a subsequent current DSH ownership fact may do so.
	admitRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, identityURL+"/v1/actors/me/merchant-role", nil)
	if err != nil {
		t.Fatal(err)
	}
	admitRequest.Header.Set("Authorization", "Bearer "+tokenCustomer)
	admitResponse, err := (&http.Client{Timeout: time.Second}).Do(admitRequest)
	if err != nil {
		t.Fatal(err)
	}
	var admission struct {
		AccessToken string `json:"accessToken"`
	}
	if admitResponse.StatusCode != http.StatusCreated {
		_ = admitResponse.Body.Close()
		t.Fatalf("real verified Customer Merchant admission denied: %d", admitResponse.StatusCode)
	}
	if err = json.NewDecoder(admitResponse.Body).Decode(&admission); err != nil {
		_ = admitResponse.Body.Close()
		t.Fatal(err)
	}
	_ = admitResponse.Body.Close()
	if len(admission.AccessToken) != 43 {
		t.Fatal("Identity merchant admission did not issue a 256-bit bearer")
	}
	if code, _ := request(http.MethodGet, admission.AccessToken, nil); code != http.StatusForbidden {
		t.Fatalf("new Merchant role implied DSH Store ownership: %d", code)
	}
	if code, _ := request(http.MethodGet, tokenCustomer, nil); code != http.StatusForbidden {
		t.Fatalf("original Customer session acquired Merchant Store authority: %d", code)
	}
	if _, err = independent.ExecContext(ctx, "UPDATE "+dshSchema+".stores SET owner_actor_id=$2 WHERE id=$1", store, customer); err != nil {
		t.Fatal(err)
	}
	if code, _ := request(http.MethodGet, admission.AccessToken, nil); code != http.StatusOK {
		t.Fatalf("current DSH ownership failed to authorize verified Merchant role: %d", code)
	}
	if code, _ := request(http.MethodGet, tokenCustomer, nil); code != http.StatusForbidden {
		t.Fatalf("Customer bearer switched to Merchant privileges after Store ownership change: %d", code)
	}
	logoutRequest, err := http.NewRequestWithContext(ctx, http.MethodDelete, identityURL+"/v1/sessions/current", nil)
	if err != nil {
		t.Fatal(err)
	}
	logoutRequest.Header.Set("Authorization", "Bearer "+admission.AccessToken)
	logoutResponse, err := (&http.Client{Timeout: time.Second}).Do(logoutRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = logoutResponse.Body.Close()
	if logoutResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("Identity refused admitted Merchant bearer revocation: %d", logoutResponse.StatusCode)
	}
	if code, _ := request(http.MethodGet, admission.AccessToken, nil); code != http.StatusUnauthorized {
		t.Fatalf("revoked newly-issued Merchant bearer retained DSH Store authority: %d", code)
	}

	// Re-enter using the same verified Customer identity. Identity must rotate
	// Merchant credentials, not reuse a logged-out bearer or grant Store rights
	// to the Customer session. DSH must re-check the current role and owner.
	rotateMerchant := func() string {
		t.Helper()
		reentry, e := http.NewRequestWithContext(ctx, http.MethodPost, identityURL+"/v1/actors/me/merchant-session", nil)
		if e != nil {
			t.Fatal(e)
		}
		reentry.Header.Set("Authorization", "Bearer "+tokenCustomer)
		response, e := (&http.Client{Timeout: time.Second}).Do(reentry)
		if e != nil {
			t.Fatal(e)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("verified Customer Merchant re-entry denied: %d", response.StatusCode)
		}
		var next struct {
			AccessToken string `json:"accessToken"`
		}
		if e = json.NewDecoder(response.Body).Decode(&next); e != nil || len(next.AccessToken) != 43 {
			t.Fatalf("Merchant re-entry returned invalid bearer: %v", e)
		}
		return next.AccessToken
	}
	firstReentry := rotateMerchant()
	if firstReentry == admission.AccessToken {
		t.Fatal("Identity reused a revoked Merchant credential")
	}
	if code, _ := request(http.MethodGet, firstReentry, nil); code != http.StatusOK {
		t.Fatalf("rotated Merchant bearer did not regain independently owned Store: %d", code)
	}
	secondReentry := rotateMerchant()
	if secondReentry == firstReentry {
		t.Fatal("Merchant session re-entry did not rotate credential")
	}
	if code, _ := request(http.MethodGet, firstReentry, nil); code != http.StatusUnauthorized {
		t.Fatalf("previous Merchant bearer remained valid after rotation: %d", code)
	}
	if code, _ := request(http.MethodGet, secondReentry, nil); code != http.StatusOK {
		t.Fatalf("latest Merchant bearer lost current Store ownership: %d", code)
	}
	if code, _ := request(http.MethodGet, tokenCustomer, nil); code != http.StatusForbidden {
		t.Fatalf("Customer bearer gained Store authority after Merchant session rotation: %d", code)
	}
	if code, _ := request(http.MethodGet, tokenB, nil); code != http.StatusForbidden {
		t.Fatalf("unrelated Merchant gained Store authority during re-entry: %d", code)
	}
	var currentOwner, issuedRole string
	if err = independent.QueryRowContext(ctx, "SELECT owner_actor_id FROM "+dshSchema+".stores WHERE id=$1", store).Scan(&currentOwner); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT role FROM "+identitySchema+".actor_roles WHERE actor_id=$1 AND role='merchant'", customer).Scan(&issuedRole); err != nil {
		t.Fatal(err)
	}
	if currentOwner != customer || issuedRole != "merchant" {
		t.Fatalf("cross-owner persisted grants are not independent: Store owner=%q role=%q", currentOwner, issuedRole)
	}
	t.Log(fmt.Sprintf("REAL_IDENTITY_DSH_POSTGRES_ISOLATED_PASS store_version=%d audits=%d commands=%d revokedGrants=%d revokedSessions=%d merchantAdmission=ONE_TIME_NO_IMPLICIT_STORE_GRANT identity_schema=%s",
		independentVersion, independentAudits, commands, revokedPermissions, revokedSessions, identitySchema))
}
