package captainstanding

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

// The opt-in joined acceptance test starts TWO real Go owner servers against
// ONE disposable PostgreSQL. It never connects to BThwani's retained runtime.
func TestCaptainJoinedRealHTTPAndPostgres(t *testing.T) {
	if os.Getenv("BTHWANI_CAPTAIN_JOINED_HTTP_TEST") != "true" {
		t.Skip("NOT_RUN: opt in to isolated joined Captain owner test")
	}
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		os.Getenv("BTHWANI_CAPTAIN_TEST_CONTAINER") != "bthwani-session02-captain-pg" {
		t.Fatal("refusing joined test without named disposable test namespace")
	}
	dsn := os.Getenv("BTHWANI_CAPTAIN_TEST_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || u.Scheme != "postgres" || u.Host != "127.0.0.1:5432" ||
		u.Path != "/refoundation_captain_agent02" || u.User == nil ||
		u.User.Username() != "bt_cap_s02" || u.Query().Get("sslmode") != "disable" {
		t.Fatal("joined Captain test must not access any retained or networked database")
	}
	password, hasPassword := u.User.Password()
	if !hasPassword || password == "" {
		t.Fatal("disposable postgres password missing")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 65*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(8)
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	var databaseName string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&databaseName); err != nil ||
		databaseName != "refoundation_captain_agent02" {
		t.Fatal("database provenance mismatch")
	}
	nonce := make([]byte, 5)
	if _, err = rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	suffix := fmt.Sprintf("%x", nonce)
	identitySchema := "identity_test_captain_joined_" + suffix
	dshSchema := "dsh_test_captain_joined_" + suffix
	for _, entry := range []struct {
		schema, root string
		files        []string
	}{
		{identitySchema, "identity", []string{
			"001_session_verification.sql", "002_operator_permission_read.sql",
			"003_verified_customer_merchant_admission.sql", "004_customer_phone_verification.sql"}},
		{dshSchema, "dsh", []string{
			"001_public_discovery.sql", "002_store_orderability.sql",
			"003_service_city_timezone.sql", "004_store_availability_city_limits.sql",
			"005_store_operational_policy_commands.sql", "006_captain_standing.sql"}},
	} {
		var ownerDir string
		if entry.root == "identity" {
			ownerDir = filepath.Join("..", "..", "..", "identity", "database", "migrations")
		} else {
			ownerDir = filepath.Join("..", "..", "..", "database", "migrations")
		}
		for _, file := range entry.files {
			sqlBytes, e := os.ReadFile(filepath.Join(ownerDir, file))
			if e != nil {
				t.Fatalf("missing %s owner migration %s: %v", entry.root, file, e)
			}
			migration := strings.ReplaceAll(string(sqlBytes), "__SCHEMA__", entry.schema)
			if _, e = db.ExecContext(ctx, migration); e != nil {
				t.Fatalf("%s migration %s failed: %v", entry.root, file, e)
			}
		}
	}

	actors := identitySchema + ".actors"
	roles := identitySchema + ".actor_roles"
	sessions := identitySchema + ".auth_sessions"
	permissions := identitySchema + ".operator_permissions"
	customer := "captain-joined-s02-a"
	secondCustomer := "captain-joined-s02-b"
	operator := "operator-joined-s02"
	for _, actor := range []string{customer, secondCustomer, operator} {
		if _, err = db.ExecContext(ctx, "INSERT INTO "+actors+
			" (id,status,verified_at) VALUES($1,'ACTIVE',clock_timestamp()-interval '1 hour')", actor); err != nil {
			t.Fatal(err)
		}
	}
	for _, entry := range []struct{ actor, role string }{{customer, "customer"}, {secondCustomer, "customer"}, {operator, "operator"}} {
		if _, err = db.ExecContext(ctx, "INSERT INTO "+roles+
			" (actor_id,role,status) VALUES($1,$2,'ACTIVE')", entry.actor, entry.role); err != nil {
			t.Fatal(err)
		}
	}
	createBearer := func(actor, role string) string {
		t.Helper()
		raw := make([]byte, 32)
		if _, err = rand.Read(raw); err != nil {
			t.Fatal(err)
		}
		token := base64.RawURLEncoding.EncodeToString(raw)
		digest := sha256.Sum256(raw)
		_, err = db.ExecContext(ctx, "INSERT INTO "+sessions+
			" (token_digest,actor_id,role,actor_version,role_version,issued_at,expires_at) VALUES($1,$2,$3,1,1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 minutes')", digest[:], actor, role)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	customerBearer := createBearer(customer, "customer")
	anotherBearer := createBearer(secondCustomer, "customer")
	operatorBearer := createBearer(operator, "operator")

	// All processes are owned by this test, share only this ephemeral namespace,
	// and cannot reach networked hosts (Docker --network none).
	identityURL := "http://127.0.0.1:33421"
	dshURL := "http://127.0.0.1:33422"
	start := func(binary string, env ...string) *exec.Cmd {
		t.Helper()
		if _, err = os.Stat(binary); err != nil {
			t.Fatalf("missing separately built real owner binary %s: %v", binary, err)
		}
		child := exec.CommandContext(ctx, binary)
		child.Env = append(os.Environ(), env...)
		// Owner process stderr can contain sensitive config; never echo it in tests.
		child.Stderr = io.Discard
		if err = child.Start(); err != nil {
			t.Fatalf("cannot start %s: %v", binary, err)
		}
		t.Cleanup(func() {
			if child.Process != nil {
				_ = child.Process.Kill()
				_ = child.Wait()
			}
		})
		return child
	}
	start("./identity-server",
		"BTHWANI_ISOLATED_TEST_MODE=true",
		"IDENTITY_DB_SCHEMA="+identitySchema,
		"IDENTITY_TEST_DATABASE_URL="+dsn,
		"IDENTITY_DEV_LISTEN_ADDR=127.0.0.1:33421",
		"IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION=true",
		"IDENTITY_DSH_CAPTAIN_STANDING_URL="+dshURL,
		"IDENTITY_SYNTHETIC_PHONE_AUTH=false")
	start("./dsh-server",
		"BTHWANI_ISOLATED_TEST_MODE=true",
		"DSH_DB_SCHEMA="+dshSchema,
		"REF_POSTGRES_USER=bt_cap_s02",
		"REF_POSTGRES_PASSWORD="+password,
		"REF_POSTGRES_DB=refoundation_captain_agent02",
		"DSH_DB_HOST=127.0.0.1",
		"DSH_LISTEN_ADDR=127.0.0.1:33422",
		"DSH_IDENTITY_VERIFIER_URL="+identityURL,
		"DSH_ENABLE_ISOLATED_CAPTAIN_STANDING=true",
		"DSH_ENABLE_ISOLATED_STORE_AVAILABILITY=false")
	httpClient := &http.Client{
		Timeout:       3 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	for _, site := range []struct {
		path   string
		expect int
	}{{identityURL + "/health", 200}, {dshURL + "/v1/captains/me/standing", 401}} {
		ready := false
		for count := 0; count < 60; count++ {
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, site.path, nil)
			resp, e := httpClient.Do(req)
			if e == nil {
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				if resp.StatusCode == site.expect {
					ready = true
					break
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
		if !ready {
			t.Fatalf("real owner %s did not reach expected status %d", site.path, site.expect)
		}
	}

	type ownerReply struct {
		ActorID     string `json:"actorId"`
		Status      string `json:"status"`
		Version     int64  `json:"version"`
		AccessToken string `json:"accessToken"`
		Role        string `json:"role"`
	}
	send := func(method, path, bearer, payload string, expect int) ownerReply {
		t.Helper()
		var body io.Reader
		if payload != "" {
			body = strings.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(ctx, method, path, body)
		if err != nil {
			t.Fatal(err)
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		req.Header.Set("X-Actor-ID", secondCustomer)
		req.Header.Set("X-Role", "operator")
		if payload != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s owner call failed: %v", method, path, err)
		}
		defer resp.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 8192))
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != expect {
			t.Fatalf("%s %s status=%d want=%d (body suppressed)", method, path, resp.StatusCode, expect)
		}
		if resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("%s missing no-store", path)
		}
		if expect >= 400 {
			return ownerReply{}
		}
		var v ownerReply
		if err = json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s invalid owner JSON: %v", path, err)
		}
		return v
	}
	application := dshURL + "/v1/actors/me/captain-application"
	eligibility := dshURL + "/v1/actors/me/captain-eligibility"
	operatorStanding := dshURL + "/v1/operators/captains/" + customer + "/standing"
	admit := identityURL + "/v1/actors/me/captain-role"
	resume := identityURL + "/v1/actors/me/captain-session"
	applied := send("POST", application, customerBearer, "", 200)
	if applied.ActorID != customer || applied.Status != "PENDING" || applied.Version != 1 {
		t.Fatalf("pending application incorrect: %+v", applied)
	}
	send("GET", eligibility, customerBearer, "", 403)
	send("POST", admit, customerBearer, "", 403)
	send("GET", eligibility, anotherBearer, "", 403)
	send("GET", dshURL+"/v1/captains/me/standing", customerBearer, "", 403)
	approval := `{"status":"APPROVED","expectedVersion":1,"operationId":"cap-joined-approval-01","reason":"synthetic separate Operator approval"}`
	send("PATCH", operatorStanding, operatorBearer, approval, 403)
	var before int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+dshSchema+".captain_standing_audit").Scan(&before); err != nil || before != 0 {
		t.Fatalf("forbidden operator mutation wrote audit count=%d err=%v", before, err)
	}
	// Synthetic fixture grants only the explicitly registered 'operations' scope;
	// this is NOT the original Operator, nor a live user or permission flow.
	_, err = db.ExecContext(ctx, "INSERT INTO "+permissions+
		"(actor_id,role,permission,state) VALUES($1,'operator','operations','ACTIVE')", operator)
	if err != nil {
		t.Fatal(err)
	}
	accepted := send("PATCH", operatorStanding, operatorBearer, approval, 200)
	if accepted.ActorID != customer || accepted.Status != "APPROVED" || accepted.Version != 2 {
		t.Fatalf("actual Operator approval not persisted: %+v", accepted)
	}
	allowed := send("GET", eligibility, customerBearer, "", 200)
	if allowed.ActorID != customer || allowed.Status != "APPROVED" {
		t.Fatalf("wrong eligibility actor %+v", allowed)
	}
	issued := send("POST", admit, customerBearer, "", 201)
	if len(issued.AccessToken) != 43 {
		t.Fatal("no real Identity Captain bearer issued")
	}
	captain := issued.AccessToken
	current := send("GET", identityURL+"/v1/sessions/current", captain, "", 200)
	if current.ActorID != customer || current.Role != "captain" {
		t.Fatalf("Identity Captain principal incorrect: %+v", current)
	}
	standing := send("GET", dshURL+"/v1/captains/me/standing", captain, "", 200)
	if standing.ActorID != customer || standing.Version != 2 {
		t.Fatalf("Captain current DSH standing incorrect: %+v", standing)
	}
	send("POST", admit, customerBearer, "", 409)
	refreshed := send("POST", resume, customerBearer, "", 200)
	if len(refreshed.AccessToken) != 43 || refreshed.AccessToken == captain {
		t.Fatal("Captain re-entry did not rotate credential")
	}
	send("GET", identityURL+"/v1/sessions/current", captain, "", 401)
	send("GET", dshURL+"/v1/captains/me/standing", refreshed.AccessToken, "", 200)

	suspension := `{"status":"SUSPENDED","expectedVersion":2,"operationId":"cap-joined-suspend-01","reason":"synthetic suspension"}`
	stopped := send("PATCH", operatorStanding, operatorBearer, suspension, 200)
	if stopped.Status != "SUSPENDED" || stopped.Version != 3 {
		t.Fatalf("DSH suspension failed: %+v", stopped)
	}
	send("GET", dshURL+"/v1/captains/me/standing", refreshed.AccessToken, "", 403)
	send("GET", eligibility, customerBearer, "", 403)
	send("POST", resume, customerBearer, "", 403)
	send("POST", admit, anotherBearer, "", 403)
	oldReplay := send("PATCH", operatorStanding, operatorBearer, approval, 200)
	if oldReplay.Status != "APPROVED" || oldReplay.Version != 2 {
		t.Fatalf("old operation replay returned newer result: %+v", oldReplay)
	}
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	var finalStatus string
	var finalVersion int64
	if err = independent.QueryRowContext(ctx, "SELECT status,version FROM "+dshSchema+".captain_standing WHERE actor_id=$1", customer).Scan(&finalStatus, &finalVersion); err != nil || finalStatus != "SUSPENDED" || finalVersion != 3 {
		t.Fatalf("independent DSH durable read status=%s version=%d err=%v", finalStatus, finalVersion, err)
	}
	var auditCount int
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+dshSchema+".captain_standing_audit WHERE actor_id=$1", customer).Scan(&auditCount); err != nil || auditCount != 2 {
		t.Fatalf("durable DSH audit count=%d err=%v", auditCount, err)
	}
	var roleCount int
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+roles+" WHERE actor_id=$1 AND role='captain' AND status='ACTIVE'", customer).Scan(&roleCount); err != nil || roleCount != 1 {
		t.Fatalf("Identity role count=%d err=%v", roleCount, err)
	}
	var sessionsCount int
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+sessions+" WHERE actor_id=$1 AND role='captain'", customer).Scan(&sessionsCount); err != nil || sessionsCount != 2 {
		t.Fatalf("durable Identity Captain credentials count=%d err=%v", sessionsCount, err)
	}
	t.Logf("PASS real Identity HTTP + real DSH HTTP + PostgreSQL owner readback: Captain actor=%s, current DSH standing=%s version=%d, audit=%d, Identity role=%d sessions=%d; synthetic only", customer, finalStatus, finalVersion, auditCount, roleCount, sessionsCount)
}
