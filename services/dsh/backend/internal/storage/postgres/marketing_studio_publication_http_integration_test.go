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

func TestStudioPublishedThemePublicHTTPExposesNoDraft(t *testing.T) {
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
		if _, err := db.ExecContext(ctx, migrations[165]); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, migrations[166]); err != nil {
			t.Fatal(err)
		}

		const serviceToken = "studio-theme-service-key-123456"
		const identityToken = "studio-theme-identity-key-123456"
		const operator = "studio-theme-test-operator"
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
		request := func(method, path string, body []byte, auth bool, expected int, key string) *httptest.ResponseRecorder {
			t.Helper()
			req := httptest.NewRequest(method, path, bytes.NewReader(body))
			if auth {
				req.Header.Set("Authorization", "Bearer "+serviceToken)
				req.Header.Set("X-Acting-Actor-ID", operator)
			}
			req.Header.Set("X-Correlation-ID", "studio-public-http-proof")
			req.Header.Set("X-Expected-Version", fmt.Sprint(expected))
			req.Header.Set("Idempotency-Key", key)
			req.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, req)
			return recorder
		}
		pubPath := "/dsh/public/studio-theme"
		opPath := "/dsh/operator/marketing/studio-theme"
		first := request("GET", pubPath, nil, false, 1, "")
		if first.Code != 200 || !strings.Contains(first.Body.String(), `"palette":null`) ||
			!strings.Contains(first.Body.String(), `"version":1`) ||
			strings.Contains(first.Body.String(), "publishedByActorId") {
			t.Fatalf("initial public default response: %d %s", first.Code, first.Body.String())
		}
		doc := studioFixture(t)
		draft, _, err := postgres.SetStudioDraft(ctx, db, doc, 1, operator, "studio-public-http-draft", "studio-public-http-save")
		if err != nil || draft.Version != 2 {
			t.Fatalf("save: %v %+v", err, draft)
		}
		readBefore := request("GET", pubPath, nil, false, 1, "")
		if readBefore.Code != 200 || strings.Contains(readBefore.Body.String(), "F36B21") {
			t.Fatalf("unpublished draft leaked to public: %d %s", readBefore.Code, readBefore.Body.String())
		}
		forbidden := request("PUT", opPath, []byte(`{"action":"ACTIVATE_DRAFT","expectedDraftVersion":2,"targetPublicationVersion":0}`), false, 1, "studio-public-http-unauth")
		if forbidden.Code != 401 {
			t.Fatalf("unauthorized publication=%d %s", forbidden.Code, forbidden.Body.String())
		}
		activated := request("PUT", opPath, []byte(`{"action":"ACTIVATE_DRAFT","expectedDraftVersion":2,"targetPublicationVersion":0}`), true, 1, "studio-public-http-activate")
		if activated.Code != 200 {
			t.Fatalf("publish=%d %s", activated.Code, activated.Body.String())
		}
		replay := request("PUT", opPath, []byte(`{"action":"ACTIVATE_DRAFT","expectedDraftVersion":2,"targetPublicationVersion":0}`), true, 1, "studio-public-http-activate")
		if replay.Code != 200 || !strings.Contains(replay.Body.String(), `"idempotentReplay":true`) {
			t.Fatalf("publication replay=%d %s", replay.Code, replay.Body.String())
		}
		live := request("GET", pubPath, nil, false, 1, "")
		if live.Code != 200 || !strings.Contains(live.Body.String(), `"navy":"#102B4E"`) ||
			!strings.Contains(live.Body.String(), `"version":2`) ||
			strings.Contains(live.Body.String(), operator) ||
			strings.Contains(live.Body.String(), "sections") ||
			strings.Contains(live.Body.String(), "publishedByActorId") {
			t.Fatalf("public palette response must hide draft/actor: %d %s", live.Code, live.Body.String())
		}
		stale := request("PUT", opPath, []byte(`{"action":"RESTORE_DEFAULTS","expectedDraftVersion":0,"targetPublicationVersion":0}`), true, 1, "studio-public-http-stale")
		if stale.Code != 409 {
			t.Fatalf("stale publication accepted=%d %s", stale.Code, stale.Body.String())
		}
		restored := request("PUT", opPath, []byte(`{"action":"RESTORE_DEFAULTS","expectedDraftVersion":0,"targetPublicationVersion":0}`), true, 2, "studio-public-http-reset")
		if restored.Code != 200 {
			t.Fatalf("restore defaults=%d %s", restored.Code, restored.Body.String())
		}
		final := request("GET", pubPath, nil, false, 1, "")
		if final.Code != 200 || !strings.Contains(final.Body.String(), `"palette":null`) ||
			!strings.Contains(final.Body.String(), `"version":3`) {
			t.Fatalf("public reset defaults=%d %s", final.Code, final.Body.String())
		}
		var eventCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.marketing_studio_publication_events").Scan(&eventCount); err != nil || eventCount != 2 {
			t.Fatalf("expected two attributed publication events, got %d err %v", eventCount, err)
		}
	})
}

func TestStudioPublicationSchemaVersionIsOne(t *testing.T) {
	var record postgres.StudioPublicationRecord
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"schemaVersion"`)) {
		t.Fatal("serialized contract missing schema version")
	}
}
