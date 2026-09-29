package transporthttp

import (
	nethttp "net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

type captainRegisteredRoute struct {
	method string
	path   string
}

var captainRouteParameterPattern = regexp.MustCompile(`\{[^}/]+\}`)

func captainRegisteredRoutes(t *testing.T) []captainRegisteredRoute {
	t.Helper()
	source, err := os.ReadFile("captain.go")
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`mux\.HandleFunc\("([A-Z]+) ([^"]+)"`)
	matches := pattern.FindAllStringSubmatch(string(source), -1)
	if len(matches) == 0 {
		t.Fatal("no Captain routes were registered")
	}
	routes := make([]captainRegisteredRoute, 0, len(matches))
	for _, match := range matches {
		routes = append(routes, captainRegisteredRoute{method: match[1], path: match[2]})
	}
	return routes
}

func concreteCaptainRoutePath(path string) string {
	return captainRouteParameterPattern.ReplaceAllString(path, "value")
}

func TestCaptainRegisteredRoutesRejectUnauthenticatedRequests(t *testing.T) {
	authorizer, err := auth.NewServiceToken(strings.Repeat("s", 24))
	if err != nil {
		t.Fatalf("create DSH service authorizer: %v", err)
	}
	server := &CaptainServer{auth: authorizer}
	mux := nethttp.NewServeMux()
	server.Register(mux)

	routes := captainRegisteredRoutes(t)
	if len(routes) != 36 {
		t.Fatalf("Captain route census changed: got %d, want 36; review authentication for every new or removed route", len(routes))
	}
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			request := httptest.NewRequest(route.method, concreteCaptainRoutePath(route.path), nil)
			response := httptest.NewRecorder()

			mux.ServeHTTP(response, request)

			if response.Code != nethttp.StatusUnauthorized {
				t.Fatalf("unauthenticated status: got %d, want %d", response.Code, nethttp.StatusUnauthorized)
			}
			if !strings.Contains(response.Body.String(), "UNAUTHENTICATED") {
				t.Fatalf("unauthenticated response did not preserve the contract: %s", response.Body.String())
			}
		})
	}
}
