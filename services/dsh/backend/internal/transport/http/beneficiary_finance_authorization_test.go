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

type beneficiaryFinanceRegisteredRoute struct {
	method string
	path   string
}

var beneficiaryFinanceRouteParameterPattern = regexp.MustCompile(`\{[^}/]+\}`)

func beneficiaryFinanceRegisteredRoutes(t *testing.T) []beneficiaryFinanceRegisteredRoute {
	t.Helper()
	files := []string{
		"beneficiary_finance.go",
		"beneficiary_settlement_governance.go",
		"customer_withdrawal.go",
	}
	pattern := regexp.MustCompile(`mux\.HandleFunc\("([A-Z]+) ([^"]+)"`)
	routes := make([]beneficiaryFinanceRegisteredRoute, 0, 44)
	for _, file := range files {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		for _, match := range pattern.FindAllStringSubmatch(string(source), -1) {
			routes = append(routes, beneficiaryFinanceRegisteredRoute{method: match[1], path: match[2]})
		}
	}
	if len(routes) == 0 {
		t.Fatal("no beneficiary finance routes were registered")
	}
	return routes
}

func concreteBeneficiaryFinanceRoutePath(path string) string {
	return beneficiaryFinanceRouteParameterPattern.ReplaceAllString(path, "value")
}

func TestBeneficiaryFinanceRegisteredRoutesRejectUnauthenticatedRequests(t *testing.T) {
	authorizer, err := auth.NewServiceToken(strings.Repeat("s", 24))
	if err != nil {
		t.Fatalf("create DSH service authorizer: %v", err)
	}
	server := &BeneficiaryFinanceServer{auth: authorizer}
	mux := nethttp.NewServeMux()
	server.Register(mux)

	routes := beneficiaryFinanceRegisteredRoutes(t)
	if len(routes) != 49 {
		t.Fatalf("beneficiary finance route census changed: got %d, want 49; review authentication for every new or removed route", len(routes))
	}
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			request := httptest.NewRequest(route.method, concreteBeneficiaryFinanceRoutePath(route.path), nil)
			request.Header.Set("X-Acting-Actor-ID", "actor_operator_test")
			request.Header.Set("X-Correlation-ID", "correlation-test")
			request.Header.Set("Idempotency-Key", "idempotency-test")
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
