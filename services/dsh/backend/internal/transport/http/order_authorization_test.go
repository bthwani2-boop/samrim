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

type orderRegisteredRoute struct {
	method string
	path   string
}

var orderRouteParameterPattern = regexp.MustCompile(`\{[^}/]+\}`)

func orderRegisteredRoutes(t *testing.T) []orderRegisteredRoute {
	t.Helper()
	source, err := os.ReadFile("order.go")
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`mux\.HandleFunc\("([A-Z]+) ([^"]+)"`)
	matches := pattern.FindAllStringSubmatch(string(source), -1)
	if len(matches) == 0 {
		t.Fatal("no Order routes were registered")
	}
	routes := make([]orderRegisteredRoute, 0, len(matches))
	for _, match := range matches {
		routes = append(routes, orderRegisteredRoute{method: match[1], path: match[2]})
	}
	return routes
}

func concreteOrderRoutePath(path string) string {
	return orderRouteParameterPattern.ReplaceAllString(path, "value")
}

func TestOrderRegisteredRoutesRejectUnauthenticatedRequests(t *testing.T) {
	authorizer, err := auth.NewServiceToken(strings.Repeat("s", 24))
	if err != nil {
		t.Fatalf("create DSH service authorizer: %v", err)
	}
	server := &OrderServer{auth: authorizer}
	mux := nethttp.NewServeMux()
	server.Register(mux)

	routes := orderRegisteredRoutes(t)
	if len(routes) != 17 {
		t.Fatalf("Order route census changed: got %d, want 17; review authentication for every new or removed route", len(routes))
	}
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			request := httptest.NewRequest(route.method, concreteOrderRoutePath(route.path), nil)
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
