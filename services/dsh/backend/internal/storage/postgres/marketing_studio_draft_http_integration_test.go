package postgres_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
	_ "github.com/lib/pq"
)

func TestStudioDraftAuthorizedHTTPPersistence(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("requires isolated PostgreSQL test URL")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if _, err := db.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, migrations[165]); err != nil {
			t.Fatal(err)
		}
		const token = "studio-service-test-token-1111111"
		const identityToken = "studio-identity-test-token-222222"
		const operator = "test-studio-operator"
		const deniedOperator = "test-studio-restricted"
		identityHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+identityToken {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			switch {
			case strings.HasSuffix(r.URL.Path, "/roles/operator"):
				_, _ = fmt.Fprintf(w, "{\"actorId\":%q,\"role\":\"operator\",\"enabled\":true,\"securityEnabled\":true,\"activatedAt\":\"2026-01-01T00:00:00Z\"}", operator)
			case strings.HasSuffix(r.URL.Path, "/permissions/marketing"):
				enabled := strings.Contains(r.URL.Path, operator)
				_, _ = fmt.Fprintf(w, "{\"actorId\":%q,\"permission\":\"marketing\",\"enabled\":%t,\"version\":1}", operator, enabled)
			default:
				http.NotFound(w, r)
			}
		}))
		defer identityHTTP.Close()
		endpoint, err := identityintegration.ResolveBaseURL(identityHTTP.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		identityClient, err := identityintegration.New(endpoint, identityToken)
		if err != nil {
			t.Fatal(err)
		}
		handler, err := transporthttp.NewMarketingWithDependencies(identityClient, token, db, nil)
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		handler.Register(mux)
		request := func(method, actor, key string, expected int, data []byte, authorized bool) *httptest.ResponseRecorder {
			t.Helper()
			req := httptest.NewRequest(method, "/dsh/operator/marketing/studio-draft", bytes.NewReader(data))
			if authorized {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			req.Header.Set("X-Acting-Actor-ID", actor)
			req.Header.Set("X-Correlation-ID", "studio-http-correlation")
			req.Header.Set("Idempotency-Key", key)
			req.Header.Set("X-Expected-Version", fmt.Sprint(expected))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, req)
			return rr
		}
		assert := func(label string, actual, want int) {
			t.Helper()
			if actual != want {
				t.Fatalf("%s status=%d want=%d", label, actual, want)
			}
		}
		assert("unauthenticated read", request("GET", operator, "unauth-read-01", 1, nil, false).Code, 401)
		assert("without marketing read", request("GET", deniedOperator, "denied-read-01", 1, nil, true).Code, 403)
		first := request("GET", operator, "read-first-01", 1, nil, true)
		assert("first read", first.Code, 200)
		if !strings.Contains(first.Body.String(), "\"version\":1") {
			t.Fatal("unexpected initial version", first.Body.String())
		}
		body, err := json.Marshal(map[string]any{"document": json.RawMessage(studioFixture(t))})
		if err != nil {
			t.Fatal(err)
		}
		assert("without marketing write", request("PUT", deniedOperator, "denied-write-01", 1, body, true).Code, 403)
		written := request("PUT", operator, "write-once-01", 1, body, true)
		assert("save", written.Code, 200)
		if !strings.Contains(written.Body.String(), "\"version\":2") {
			t.Fatal("missing version 2")
		}
		replay := request("PUT", operator, "write-once-01", 1, body, true)
		assert("same key replay", replay.Code, 200)
		if !strings.Contains(replay.Body.String(), "\"idempotentReplay\":true") {
			t.Fatal("replay not marked")
		}
		assert("stale writer", request("PUT", operator, "write-stale-01", 1, body, true).Code, 409)
		last := request("GET", operator, "read-after-01", 2, nil, true)
		assert("last read", last.Code, 200)
		if !strings.Contains(last.Body.String(), "\"version\":2") {
			t.Fatal("read did not preserve version 2")
		}
	})
}
