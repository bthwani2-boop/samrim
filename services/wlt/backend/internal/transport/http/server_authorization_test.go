package http

import (
	"database/sql"
	"encoding/json"
	nethttp "net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
)

type registeredRoute struct {
	method string
	path   string
}

var routeParameterPattern = regexp.MustCompile(`\{[^}/]+\}`)

func registeredRoutes(t *testing.T) []registeredRoute {
	t.Helper()
	serverSource, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	routePattern := regexp.MustCompile(`mux\.HandleFunc\("([A-Z]+) ([^"]+)"`)
	matches := routePattern.FindAllStringSubmatch(string(serverSource), -1)
	if len(matches) == 0 {
		t.Fatal("no WLT routes were registered")
	}
	routes := make([]registeredRoute, 0, len(matches))
	for _, match := range matches {
		routes = append(routes, registeredRoute{method: match[1], path: match[2]})
	}
	return routes
}

func concreteRoutePath(path string) string {
	return routeParameterPattern.ReplaceAllString(path, "value")
}

func TestRegisteredRoutesRequireServiceAuthorization(t *testing.T) {
	key := strings.Repeat("00", 32)
	server, err := NewWithCashInConfig(&sql.DB{}, "service-token", key, key, "simulator", "development")
	if err != nil {
		t.Fatalf("create WLT server: %v", err)
	}
	mux := nethttp.NewServeMux()
	server.Register(mux)

	for _, route := range registeredRoutes(t) {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			request := httptest.NewRequest(route.method, concreteRoutePath(route.path), nil)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)

			if response.Code != nethttp.StatusUnauthorized {
				t.Fatalf("status: got %d, want %d", response.Code, nethttp.StatusUnauthorized)
			}
			var body struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode authorization response: %v", err)
			}
			if body.Error.Code != "UNAUTHENTICATED" {
				t.Fatalf("error code: got %q, want UNAUTHENTICATED", body.Error.Code)
			}
			if got := response.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control: got %q, want no-store", got)
			}
			if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
				t.Fatalf("Content-Type: got %q, want application/json", got)
			}
		})
	}
}
