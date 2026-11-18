package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Runs only inside session-02's disposable Docker --network none PostgreSQL.
// It proves the Identity owner writer and HTTP handler, not Operator Passkey.
func TestOperatorPermissionManagementRealPostgresAndHTTP(t *testing.T) {
	if os.Getenv("BTHWANI_OPERATOR_ADMIN_TEST") != "true" {
		t.Skip("NOT_RUN: explicit disposable Operator owner DB test")
	}
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		os.Getenv("BTHWANI_OPERATOR_TEST_CONTAINER") != "bthwani-session02-operator-pg" {
		t.Fatal("refuse non-disposable Operator test namespace")
	}
	dsn := os.Getenv("BTHWANI_OPERATOR_TEST_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || u.Scheme != "postgres" || u.Host != "127.0.0.1:5432" ||
		u.Path != "/refoundation_operator_agent02" || u.User == nil ||
		u.User.Username() != "bt_op_s02" || u.Query().Get("sslmode") != "disable" {
		t.Fatal("refuse any Operator DB other than dedicated synthetic PostgreSQL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(14)
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	var dbName string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&dbName); err != nil || dbName != "refoundation_operator_agent02" {
		t.Fatal("isolated database name mismatch")
	}
	nonce := make([]byte, 5)
	if _, err = rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("identity_test_operator_admin_%x", nonce)
	for _, file := range []string{"001_session_verification.sql", "002_operator_permission_read.sql",
		"003_verified_customer_merchant_admission.sql", "004_customer_phone_verification.sql",
		"005_operator_permission_management.sql"} {
		raw, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", file))
		if e != nil {
			t.Fatalf("missing owner migration %s: %v", file, e)
		}
		sqlSource := strings.ReplaceAll(string(raw), "__SCHEMA__", schema)
		if _, e = db.ExecContext(ctx, sqlSource); e != nil {
			t.Fatalf("synthetic migration %s: %v", file, e)
		}
	}
	reader, err := NewPostgresReader(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	actors := schema + ".actors"
	roles := schema + ".actor_roles"
	sessions := schema + ".auth_sessions"
	permissions := schema + ".operator_permissions"
	commands := schema + ".operator_permission_commands"
	original := "operator-original-s02"
	target := "operator-target-s02"
	outsider := "operator-outsider-s02"
	independentTarget := "operator-other-s02"
	for _, actor := range []string{original, target, outsider, independentTarget} {
		if _, err = db.ExecContext(ctx, "INSERT INTO "+actors+
			" (id,status,verified_at) VALUES($1,'ACTIVE',clock_timestamp()-interval '1 hour')", actor); err != nil {
			t.Fatal(err)
		}
		if _, err = db.ExecContext(ctx, "INSERT INTO "+roles+
			" (actor_id,role,status) VALUES($1,'operator','ACTIVE')", actor); err != nil {
			t.Fatal(err)
		}
	}
	// This is an isolated test fixture; no production bootstrap, enrollment,
	// protected original-actor identity, or recovery credential is created.
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+
		".operator_bootstrap(singleton,actor_id,role) VALUES(true,$1,'operator')", original); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+permissions+
		"(actor_id,role,permission,state) VALUES($1,'operator','finance','ACTIVE'),($1,'operator','platform_policies','ACTIVE')", outsider); err != nil {
		t.Fatal(err)
	}

	makeBearer := func(actor string, roleVersion int64) string {
		t.Helper()
		raw := make([]byte, 32)
		if _, e := rand.Read(raw); e != nil {
			t.Fatal(e)
		}
		digest := sha256.Sum256(raw)
		_, e := db.ExecContext(ctx, "INSERT INTO "+sessions+
			"(token_digest,actor_id,role,actor_version,role_version,issued_at,expires_at) "+
			"VALUES($1,$2,'operator',1,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '20 minutes')",
			digest[:], actor, roleVersion)
		if e != nil {
			t.Fatal(e)
		}
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	rootBearer := makeBearer(original, 1)
	targetBearer := makeBearer(target, 1)
	outsideBearer := makeBearer(outsider, 1)
	otherBearer := makeBearer(independentTarget, 1)

	srv := httptest.NewServer(NewOperatorPermissionManagementHandler(reader))
	defer srv.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	path := "/v1/operators/" + target + "/permissions/operations"
	call := func(bearer string, command OperatorPermissionCommand, want int) OperatorPermissionResult {
		t.Helper()
		raw, e := json.Marshal(struct {
			State           string `json:"state"`
			ExpectedVersion int64  `json:"expectedVersion"`
			OperationID     string `json:"operationId"`
			Reason          string `json:"reason"`
		}{command.State, command.ExpectedVersion, command.OperationID, command.Reason})
		if e != nil {
			t.Fatal(e)
		}
		req, e := http.NewRequestWithContext(ctx, http.MethodPatch, srv.URL+path, strings.NewReader(string(raw)))
		if e != nil {
			t.Fatal(e)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("X-Actor-ID", original) // client spoofing never grants original-actor authority
		req.Header.Set("X-Role", "operator")
		response, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer response.Body.Close()
		if response.StatusCode != want {
			t.Fatalf("HTTP status=%d want=%d (error details intentionally hidden)", response.StatusCode, want)
		}
		if response.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("permission admin HTTP is cacheable")
		}
		if want != 200 {
			return OperatorPermissionResult{}
		}
		var result OperatorPermissionResult
		if e = json.NewDecoder(io.LimitReader(response.Body, 2048)).Decode(&result); e != nil {
			t.Fatal(e)
		}
		return result
	}
	command := OperatorPermissionCommand{
		TargetActorID: target, Permission: "operations", State: "ACTIVE", ExpectedVersion: 0,
		OperationID: "operator-s02-grant-a", Reason: "Owner-reviewed synthetic operations grant",
	}
	call(outsideBearer, command, 403) // finance+platform_policies NEVER delegate admin rights
	call(targetBearer, command, 403)
	call(rootBearer[:len(rootBearer)-1]+"_", command, 401)
	var before int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+commands).Scan(&before); err != nil || before != 0 {
		t.Fatalf("forbidden command wrote audit count=%d err=%v", before, err)
	}
	result := call(rootBearer, command, 200)
	if result.State != "ACTIVE" || result.Version != 1 || result.TargetActorID != target {
		t.Fatalf("owner grant mismatch: %+v", result)
	}
	if _, err = NewVerifier(reader).Verify(ctx, "Bearer "+targetBearer); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("target stale Operator bearer not revoked after grant: %v", err)
	}
	newTargetBearer := makeBearer(target, 2)
	if _, err = NewVerifier(reader).VerifyPermission(ctx, "Bearer "+newTargetBearer, "operations"); err != nil {
		t.Fatalf("effective permission not current after verified grant: %v", err)
	}
	repeat := call(rootBearer, command, 200)
	if repeat != result {
		t.Fatal("idempotent replay changed result")
	}
	// An acknowledged grant remains replay-readable after the target later
	// loses standing; new permission mutations must still fail closed.
	if _, err = db.ExecContext(ctx, "UPDATE "+actors+" SET status='SUSPENDED' WHERE id=$1", target); err != nil {
		t.Fatal(err)
	}
	suspendedRepeat := call(rootBearer, command, 200)
	if suspendedRepeat != result {
		t.Fatal("suspended target changed a recorded operation's historical reply")
	}
	blocked := command
	blocked.OperationID = "operator-s02-blocked-suspended"
	blocked.State = "REVOKED"
	blocked.ExpectedVersion = 1
	call(rootBearer, blocked, 404)
	if _, err = db.ExecContext(ctx, "UPDATE "+actors+" SET status='ACTIVE' WHERE id=$1", target); err != nil {
		t.Fatal(err)
	}
	conflicting := command
	conflicting.State = "REVOKED"
	call(rootBearer, conflicting, 409) // operationId reused with conflicting input
	stale := command
	stale.OperationID = "operator-s02-stale-b"
	call(rootBearer, stale, 409) // already granted with obsolete expected version
	var auditBefore int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+commands).Scan(&auditBefore); err != nil || auditBefore != 1 {
		t.Fatalf("one confirmed grant must have exactly one audit: %d %v", auditBefore, err)
	}

	// Distinct operation IDs contending against the same expected version:
	// exactly one writer succeeds; no duplicate grant/role invalidation.
	const contenders = 10
	statuses := make(chan int, contenders)
	var wg sync.WaitGroup
	for i := 0; i < contenders; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			cmd := command
			cmd.State = "REVOKED"
			cmd.ExpectedVersion = 1
			cmd.OperationID = fmt.Sprintf("operator-s02-concurrent-%d", index)
			payload, _ := json.Marshal(map[string]any{
				"state": cmd.State, "expectedVersion": cmd.ExpectedVersion,
				"operationId": cmd.OperationID, "reason": cmd.Reason,
			})
			req, e := http.NewRequestWithContext(ctx, http.MethodPatch, srv.URL+path, strings.NewReader(string(payload)))
			if e != nil {
				statuses <- 0
				return
			}
			req.Header.Set("Authorization", "Bearer "+rootBearer)
			req.Header.Set("Content-Type", "application/json")
			resp, e := client.Do(req)
			if e != nil {
				statuses <- 0
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			statuses <- resp.StatusCode
		}(i)
	}
	wg.Wait()
	close(statuses)
	successes, conflicts := 0, 0
	for status := range statuses {
		switch status {
		case 200:
			successes++
		case 409:
			conflicts++
		default:
			t.Fatalf("concurrent authorization unexpected HTTP %d", status)
		}
	}
	if successes != 1 || conflicts != contenders-1 {
		t.Fatalf("concurrent permissions expected one writer: wins=%d conflicts=%d", successes, conflicts)
	}
	if _, err = NewVerifier(reader).Verify(ctx, "Bearer "+newTargetBearer); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("target bearer survived grant revocation: %v", err)
	}
	finalBearer := makeBearer(target, 3)
	if _, err = NewVerifier(reader).VerifyPermission(ctx, "Bearer "+finalBearer, "operations"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("revoked Operator scope remains usable: %v", err)
	}
	if _, err = NewVerifier(reader).Verify(ctx, "Bearer "+otherBearer); err != nil {
		t.Fatalf("other Operator session changed: %v", err)
	}
	// Fail closed when original root actor is suspended, even with an
	// unexpired opaque bearer and otherwise valid request shape.
	if _, err = db.ExecContext(ctx, "UPDATE "+actors+" SET status='SUSPENDED' WHERE id=$1", original); err != nil {
		t.Fatal(err)
	}
	again := command
	again.OperationID = "operator-s02-deny-suspended"
	again.ExpectedVersion = 2
	call(rootBearer, again, 403)

	verifyDB, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer verifyDB.Close()
	var state string
	var version, roleVersion int64
	if err = verifyDB.QueryRowContext(ctx, "SELECT state,version FROM "+permissions+
		" WHERE actor_id=$1 AND permission='operations'", target).Scan(&state, &version); err != nil || state != "REVOKED" || version != 2 {
		t.Fatalf("DB owner grant final state=%s version=%d err=%v", state, version, err)
	}
	if err = verifyDB.QueryRowContext(ctx, "SELECT version FROM "+roles+
		" WHERE actor_id=$1 AND role='operator'", target).Scan(&roleVersion); err != nil || roleVersion != 3 {
		t.Fatalf("target role version=%d err=%v", roleVersion, err)
	}
	var auditCount int
	if err = verifyDB.QueryRowContext(ctx, "SELECT count(*) FROM "+commands).Scan(&auditCount); err != nil || auditCount != 2 {
		t.Fatalf("audit not exactly grant+revoke: count=%d err=%v", auditCount, err)
	}
	t.Logf("PASS two synthetic Operator principals; original-only admin; one concurrent writer; revocation; independent owner PostgreSQL readback version=%d audit=%d", version, auditCount)
}
