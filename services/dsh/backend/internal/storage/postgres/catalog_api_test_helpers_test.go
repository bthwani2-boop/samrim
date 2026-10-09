package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
)

const catalogTestIdentityToken = "tttttttttttttttttttttttttttttttt"
const catalogTestServiceToken = "ssssssssssssssssssssssss"

type dshCatalogTestAPI struct {
	mux               *http.ServeMux
	permissionEnabled bool
	reconcile         func(context.Context) error
}

func newDSHCatalogTestAPI(t *testing.T, db *sql.DB, mediaStore media.Store) *dshCatalogTestAPI {
	t.Helper()
	api := &dshCatalogTestAPI{permissionEnabled: true}
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer "+catalogTestIdentityToken {
			http.Error(w, "unauthorized test identity request", http.StatusUnauthorized)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/internal/actors/") && strings.HasSuffix(r.URL.Path, "/roles/operator") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"actorId":"`+testOperatorActorID+`","role":"operator","enabled":true,"securityEnabled":true,"activatedAt":"2026-01-01T00:00:00Z"}`)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/internal/operators/") && strings.HasSuffix(r.URL.Path, "/permissions/catalog") {
			w.Header().Set("Content-Type", "application/json")
			permission := "false"
			if api.permissionEnabled {
				permission = "true"
			}
			_, _ = io.WriteString(w, `{"actorId":"`+testOperatorActorID+`","permission":"catalog","enabled":`+permission+`,"version":1,"reason":"isolated test"}`)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(identityServer.Close)
	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatalf("validate isolated Identity endpoint: %v", err)
	}
	identityClient, err := identityintegration.New(endpoint, catalogTestIdentityToken)
	if err != nil {
		t.Fatalf("create isolated Identity client: %v", err)
	}
	server, err := transporthttp.NewCatalogWithMediaStore(identityClient, catalogTestServiceToken, db, mediaStore)
	if err != nil {
		t.Fatalf("create DSH catalog API: %v", err)
	}
	api.mux = http.NewServeMux()
	server.Register(api.mux)
	api.reconcile = server.ReconcileMediaStorage
	return api
}

func (api *dshCatalogTestAPI) request(t *testing.T, method, path string, body any, correlationID, idempotencyKey string, expectedVersion int) *httptest.ResponseRecorder {
	t.Helper()
	var requestBody io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encode catalog API request: %v", err)
		}
		requestBody = strings.NewReader(string(encoded))
	}
	request := httptest.NewRequest(method, path, requestBody)
	request.Header.Set("Authorization", "Bearer "+catalogTestServiceToken)
	request.Header.Set("X-Acting-Actor-ID", testOperatorActorID)
	if correlationID != "" {
		request.Header.Set("X-Correlation-ID", correlationID)
	}
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	if expectedVersion > 0 {
		request.Header.Set("X-Expected-Version", strconv.Itoa(expectedVersion))
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	api.mux.ServeHTTP(response, request)
	return response
}
