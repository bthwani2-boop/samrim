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

type fieldRegisteredRoute struct {
	method string
	path   string
}

var fieldRouteParameterPattern = regexp.MustCompile(`\{[^}/]+\}`)

var fieldOperatorRoutes = []fieldRegisteredRoute{
	{method: "GET", path: "/dsh/fields/admissions"},
	{method: "POST", path: "/dsh/fields/admissions"},
	{method: "PATCH", path: "/dsh/fields/admissions/{admissionId}/profile"},
	{method: "POST", path: "/dsh/fields/admissions/{admissionId}/profile-review"},
	{method: "POST", path: "/dsh/fields/admissions/{admissionId}/approve"},
	{method: "POST", path: "/dsh/fields/admissions/{admissionId}/provision"},
	{method: "GET", path: "/dsh/fields/admissions/{admissionId}"},
	{method: "GET", path: "/dsh/fields/actors/{actorId}/admission"},
	{method: "POST", path: "/dsh/fields/{actorId}/identity-role"},
	{method: "POST", path: "/dsh/fields/{actorId}/reenrollment"},
}

var fieldSessionRoutes = []fieldRegisteredRoute{
	{method: "GET", path: "/dsh/fields/me"},
}

func fieldRegisteredRoutes(t *testing.T) []fieldRegisteredRoute {
	t.Helper()
	source, err := os.ReadFile("field.go")
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`mux\.HandleFunc\("([A-Z]+) ([^"]+)"`)
	matches := pattern.FindAllStringSubmatch(string(source), -1)
	routes := make([]fieldRegisteredRoute, 0, len(matches))
	for _, match := range matches {
		routes = append(routes, fieldRegisteredRoute{method: match[1], path: match[2]})
	}
	return routes
}

func fieldRouteKey(route fieldRegisteredRoute) string {
	return route.method + " " + route.path
}

func concreteFieldRoutePath(path string) string {
	return fieldRouteParameterPattern.ReplaceAllString(path, "value")
}

func TestFieldRegisteredRouteAuthenticationModelIsExhaustive(t *testing.T) {
	expected := make(map[string]struct{}, len(fieldOperatorRoutes)+len(fieldSessionRoutes))
	for _, route := range append(append([]fieldRegisteredRoute{}, fieldOperatorRoutes...), fieldSessionRoutes...) {
		key := fieldRouteKey(route)
		if _, exists := expected[key]; exists {
			t.Fatalf("Field authentication route classified more than once: %s", key)
		}
		expected[key] = struct{}{}
	}

	routes := fieldRegisteredRoutes(t)
	if len(routes) != len(expected) {
		t.Fatalf("Field route census changed: got %d registered routes, want %d classified routes", len(routes), len(expected))
	}
	for _, route := range routes {
		key := fieldRouteKey(route)
		if _, ok := expected[key]; !ok {
			t.Fatalf("unclassified Field authentication route: %s", key)
		}
		delete(expected, key)
	}
	if len(expected) != 0 {
		t.Fatalf("classified Field routes are no longer registered: %v", expected)
	}
}

func TestFieldOperatorRoutesRejectUnauthenticatedRequests(t *testing.T) {
	testFieldRoutesRejectUnauthenticated(t, fieldOperatorRoutes)
}

func TestFieldSessionRoutesRejectUnauthenticatedRequests(t *testing.T) {
	testFieldRoutesRejectUnauthenticated(t, fieldSessionRoutes)
}

func testFieldRoutesRejectUnauthenticated(t *testing.T, routes []fieldRegisteredRoute) {
	t.Helper()
	authorizer, err := auth.NewServiceToken(strings.Repeat("s", 24))
	if err != nil {
		t.Fatalf("create DSH service authorizer: %v", err)
	}
	server := &FieldServer{auth: authorizer}
	mux := nethttp.NewServeMux()
	server.Register(mux)

	for _, route := range routes {
		t.Run(fieldRouteKey(route), func(t *testing.T) {
			request := httptest.NewRequest(route.method, concreteFieldRoutePath(route.path), nil)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != nethttp.StatusUnauthorized {
				t.Fatalf("unauthenticated status: got %d, want %d; body=%s", response.Code, nethttp.StatusUnauthorized, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), "UNAUTHENTICATED") {
				t.Fatalf("unauthenticated response did not preserve the contract: %s", response.Body.String())
			}
		})
	}
}

// A retired Field host must not expose any joining-case or photo entrypoints.
// Operator and Partner readers/writers preserve access to canonical history.
func TestRetiredFieldAppRoutesAreUnavailable(t *testing.T) {
	mux := nethttp.NewServeMux()
	(&FieldServer{}).Register(mux)
	(&JoiningCaseServer{}).Register(mux)
	for _, route := range []fieldRegisteredRoute{
		{method: "POST", path: "/dsh/field/joining-cases"},
		{method: "PATCH", path: "/dsh/field/joining-cases/case-1/draft"},
		{method: "PATCH", path: "/dsh/field/joining-cases/case-1/correction"},
		{method: "POST", path: "/dsh/field/joining-cases/case-1/submit"},
		{method: "POST", path: "/dsh/field/joining-cases/case-1/review-photo"},
		{method: "POST", path: "/dsh/field/joining-cases/case-1/commercial-agreements"},
		{method: "GET", path: "/dsh/field/joining-cases"},
		{method: "GET", path: "/dsh/field/joining-cases/case-1"},
		{method: "GET", path: "/dsh/field/joining-cases/case-1/commercial-agreements"},
		{method: "GET", path: "/dsh/field/joining-cases/case-1/commercial-agreement-defaults"},
		{method: "POST", path: "/dsh/joining-cases/case-1/internal-photos"},
	} {
		request := httptest.NewRequest(route.method, route.path, nil)
		_, pattern := mux.Handler(request)
		if pattern != "" {
			t.Fatalf("retired Field-app entrypoint is still routed: %s %s => %s", route.method, route.path, pattern)
		}
	}
	for _, route := range []fieldRegisteredRoute{
		{method: "GET", path: "/dsh/joining-cases/case-1"},
		{method: "GET", path: "/dsh/operator/partners/stores/store-1/commercial-agreements"},
		{method: "POST", path: "/dsh/operator/partners/stores/store-1/commercial-agreements"},
		{method: "POST", path: "/dsh/partner/stores/store-1/commercial-agreements/terms-1/accept"},
	} {
		request := httptest.NewRequest(route.method, route.path, nil)
		_, pattern := mux.Handler(request)
		if pattern == "" {
			t.Errorf("required Operator/Partner read or writer disappeared: %s %s", route.method, route.path)
		}
	}
}
