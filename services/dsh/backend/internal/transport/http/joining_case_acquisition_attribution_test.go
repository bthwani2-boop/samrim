package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAttributionRouteRetired(t *testing.T) {
	router := http.NewServeMux()
	(&JoiningCaseServer{}).Register(router)
	request := httptest.NewRequest(http.MethodPost, "/dsh/joining-cases/case-1/acquisition-attribution", nil)
	_, pattern := router.Handler(request)
	if pattern != "" {
		t.Fatalf("legacy attribution route is still registered: %s", pattern)
	}
}
