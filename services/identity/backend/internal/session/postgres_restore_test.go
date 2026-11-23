package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"testing"
)

// Run only against the two disposable databases created by the owner CI stage.
func verifyIdentityRestore(t *testing.T, ctx context.Context, source, schema, revoked, restricted, active string) {
	t.Helper()
	const sourceDB = "bthwani_refoundation"
	const targetDB = "bthwani_refoundation_identity_restore"
	password := os.Getenv("BTHWANI_CI_DISPOSABLE_PASSWORD")
	if !regexp.MustCompile("^[a-f0-9]{64}$").MatchString(password) {
		t.Fatal("Identity restore requires a valid ephemeral CI credential")
	}
	prefix := "postgres://bthwani_ci:" + password + "@127.0.0.1:5432/"
	const suffix = "?sslmode=disable"
	if source != prefix+sourceDB+suffix || !IsIsolatedTestSchema(schema) {
		t.Fatal("Identity restore requires the isolated CI source and schema")
	}
	archive := filepath.Join(t.TempDir(), "identity-owner.dump")
	run := func(binary string, args ...string) {
		t.Helper()
		connection := []string{"--host=127.0.0.1", "--port=5432", "--username=bthwani_ci", "--no-password"}
		command := exec.CommandContext(ctx, binary, append(connection, args...)...)
		command.Env = append(os.Environ(), "PGPASSWORD="+password)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("%s failed: %v\n%s", binary, err, output)
		}
	}
	run("pg_dump", "--format=custom", "--no-owner", "--dbname="+sourceDB, "--schema="+schema, "--file="+archive)
	run("pg_restore", "--no-owner", "--exit-on-error", "--single-transaction", "--dbname="+targetDB, archive)

	db, err := sql.Open("postgres", prefix+targetDB+suffix)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	reader, err := NewPostgresReader(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewHandler(NewVerifier(reader)))
	defer server.Close()
	for _, check := range []struct {
		path, token, actor, permission string
		want                           int
	}{
		{"/v1/sessions/current", revoked, "", "", http.StatusUnauthorized},
		{"/v1/sessions/current", restricted, "identity-operator-a", "", http.StatusOK},
		{"/v1/operators/me/permissions/operations", restricted, "", "", http.StatusForbidden},
		{"/v1/operators/me/permissions/operations", active, "", "", http.StatusForbidden},
		{"/v1/operators/me/permissions/marketing", active, "identity-operator-b", "marketing", http.StatusOK},
	} {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+check.path, nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+check.token)
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			ActorID    string `json:"actorId"`
			Permission string `json:"permission"`
		}
		decodeErr := json.NewDecoder(response.Body).Decode(&body)
		response.Body.Close()
		if response.StatusCode != check.want || response.Header.Get("Cache-Control") != "no-store" ||
			decodeErr != nil || body.ActorID != check.actor || body.Permission != check.permission {
			t.Fatalf("restored Identity authorization drifted for %s status=%d want=%d", check.path, response.StatusCode, check.want)
		}
	}
}
