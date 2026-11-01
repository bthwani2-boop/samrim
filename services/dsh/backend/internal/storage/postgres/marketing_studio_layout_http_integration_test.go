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

func TestStudioLayoutPublicHTTPVersionRollbackAndOperatorPermission(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated test PostgreSQL only")
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
		// This minimal Studio fixture starts from v166. Store-contact v168
		// requires the full Store schema and has a separate migration owner;
		// Studio's layout feature itself is introduced by v169.
		for _, index := range []int{165, 166, 168} {
			if _, err := db.ExecContext(ctx, migrations[index]); err != nil {
				t.Fatalf("migration %d: %v", index+1, err)
			}
		}

		const serviceToken = "studio-layout-service-key-123456"
		const identityToken = "studio-layout-identity-key-123456"
		const operator = "studio-layout-test-operator"
		mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+identityToken {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			switch {
			case strings.HasSuffix(r.URL.Path, "/roles/operator"):
				_, _ = fmt.Fprintf(w, `{"actorId":%q,"role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-01-01T00:00:00Z"}`, operator)
			case strings.HasSuffix(r.URL.Path, "/permissions/marketing"):
				if strings.Contains(r.URL.Path, "no-marketing") {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				_, _ = fmt.Fprintf(w, `{"actorId":%q,"permission":"marketing","enabled":true,"version":1}`, operator)
			default:
				http.NotFound(w, r)
			}
		}))
		defer mock.Close()
		baseURL, err := identityintegration.ResolveBaseURL(mock.URL, "test")
		if err != nil {
			t.Fatal(err)
		}
		client, err := identityintegration.New(baseURL, identityToken)
		if err != nil {
			t.Fatal(err)
		}
		server, err := transporthttp.NewMarketingWithDependencies(client, serviceToken, db, nil)
		if err != nil {
			t.Fatal(err)
		}
		mux := http.NewServeMux()
		server.Register(mux)
		request := func(method, path string, body []byte, authorized bool, expected int, key string) *httptest.ResponseRecorder {
			t.Helper()
			req := httptest.NewRequest(method, path, bytes.NewReader(body))
			if authorized {
				req.Header.Set("Authorization", "Bearer "+serviceToken)
				req.Header.Set("X-Acting-Actor-ID", operator)
			}
			req.Header.Set("X-Correlation-ID", "studio-layout-http-proof")
			req.Header.Set("X-Expected-Version", fmt.Sprint(expected))
			req.Header.Set("Idempotency-Key", key)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			return rec
		}
		publicPath := "/dsh/public/studio-layout"
		operatorPath := "/dsh/operator/marketing/studio-layout"
		initial := request("GET", publicPath, nil, false, 1, "")
		if initial.Code != 200 || !strings.Contains(initial.Body.String(), `"document":null`) ||
			!strings.Contains(initial.Body.String(), `"version":1`) ||
			strings.Contains(initial.Body.String(), "publishedByActorId") {
			t.Fatalf("initial public layout %d %s", initial.Code, initial.Body.String())
		}
		draftDocument := studioFixture(t)
		draft, replay, err := postgres.SetStudioDraft(ctx, db, draftDocument, 1, operator,
			"studio-layout-http-save", "studio-layout-http-save-key")
		if err != nil || replay || draft.Version != 2 {
			t.Fatalf("draft: %v %+v", err, draft)
		}
		before := request("GET", publicPath, nil, false, 1, "")
		if before.Code != 200 || strings.Contains(before.Body.String(), `"slides"`) {
			t.Fatalf("unpublished draft leaked: %d %s", before.Code, before.Body.String())
		}
		body := []byte(`{"action":"ACTIVATE_DRAFT","expectedDraftVersion":2,"targetPublicationVersion":0}`)
		denied := request("PUT", operatorPath, body, false, 1, "layout-no-auth-attempt")
		if denied.Code != 401 {
			t.Fatalf("unauthorized publish = %d %s", denied.Code, denied.Body.String())
		}
		activated := request("PUT", operatorPath, body, true, 1, "layout-http-activate")
		if activated.Code != 200 || !strings.Contains(activated.Body.String(), `"version":2`) {
			t.Fatalf("activate = %d %s", activated.Code, activated.Body.String())
		}
		identicalReplay := request("PUT", operatorPath, body, true, 1, "layout-http-activate")
		if identicalReplay.Code != 200 || !strings.Contains(identicalReplay.Body.String(), `"idempotentReplay":true`) {
			t.Fatalf("idempotent replay = %d %s", identicalReplay.Code, identicalReplay.Body.String())
		}
		keyConflict := request("PUT", operatorPath, []byte(`{"action":"RESTORE_DEFAULTS","expectedDraftVersion":0,"targetPublicationVersion":0}`), true, 1, "layout-http-activate")
		if keyConflict.Code != 409 {
			t.Fatalf("key reuse must conflict: %d %s", keyConflict.Code, keyConflict.Body.String())
		}
		stale := request("PUT", operatorPath, body, true, 1, "layout-http-stale")
		if stale.Code != 409 {
			t.Fatalf("stale version must conflict: %d %s", stale.Code, stale.Body.String())
		}
		live := request("GET", publicPath, nil, false, 1, "")
		if live.Code != 200 || !strings.Contains(live.Body.String(), `"slides"`) ||
			strings.Contains(live.Body.String(), "publishedByActorId") || strings.Contains(live.Body.String(), "idempotency") {
			t.Fatalf("published layout invalid: %d %s", live.Code, live.Body.String())
		}
		restore := request("PUT", operatorPath, []byte(`{"action":"RESTORE_DEFAULTS","expectedDraftVersion":0,"targetPublicationVersion":0}`), true, 2, "layout-http-defaults")
		if restore.Code != 200 || !strings.Contains(restore.Body.String(), `"version":3`) {
			t.Fatalf("restore compiled: %d %s", restore.Code, restore.Body.String())
		}
		rollback := request("PUT", operatorPath, []byte(`{"action":"ROLLBACK","expectedDraftVersion":0,"targetPublicationVersion":2}`), true, 3, "layout-http-rollback")
		if rollback.Code != 200 || !strings.Contains(rollback.Body.String(), `"version":4`) ||
			!strings.Contains(rollback.Body.String(), `"slides"`) {
			t.Fatalf("rollback: %d %s", rollback.Code, rollback.Body.String())
		}
		history := request("GET", operatorPath+"/history", nil, true, 4, "")
		if history.Code != 200 || !strings.Contains(history.Body.String(), "ROLLBACK") ||
			!strings.Contains(history.Body.String(), "RESTORE_DEFAULTS") {
			t.Fatalf("missing audit history %d %s", history.Code, history.Body.String())
		}
		forbiddenRead := request("GET", operatorPath, nil, false, 4, "")
		if forbiddenRead.Code != 401 {
			t.Fatalf("operator read must be private: %d", forbiddenRead.Code)
		}
		var decoded struct {
			Document json.RawMessage `json:"document"`
			Version  int             `json:"version"`
		}
		if err := json.Unmarshal(live.Body.Bytes(), &decoded); err != nil || decoded.Version != 2 {
			t.Fatalf("published readback: %v version=%d", err, decoded.Version)
		}
		palette, err := postgres.ReadStudioPublication(ctx, db)
		if err != nil || palette.Version != 1 || palette.Palette != nil {
			t.Fatalf("layout publication must never change published palette: %v %+v", err, palette)
		}
	})
}
