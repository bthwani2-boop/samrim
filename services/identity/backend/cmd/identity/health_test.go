package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubPinger struct {
	err   error
	calls int
}

func (p *stubPinger) PingContext(context.Context) error {
	p.calls++
	return p.err
}

func TestIsolatedHealthReadiness(t *testing.T) {
	for _, tc := range []struct {
		name, method, path, body string
		pingErr                  error
		status, calls            int
	}{
		{"ready", http.MethodGet, "/health", "", nil, http.StatusOK, 1},
		{"db unavailable", http.MethodGet, "/health", "", errors.New("secret connection failure"), http.StatusServiceUnavailable, 1},
		{"deny POST", http.MethodPost, "/health", "", nil, http.StatusMethodNotAllowed, 0},
		{"deny query", http.MethodGet, "/health?debug=true", "", nil, http.StatusBadRequest, 0},
		{"deny body", http.MethodGet, "/health", "payload", nil, http.StatusBadRequest, 0},
		{"deny chunked body", http.MethodGet, "/health", "chunked-payload", nil, http.StatusBadRequest, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ping := &stubPinger{err: tc.pingErr}
			recorder := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.name == "deny chunked body" {
				req.ContentLength = -1
				req.TransferEncoding = []string{"chunked"}
			}
			isolatedHealthHandler(ping).ServeHTTP(recorder, req)
			if recorder.Code != tc.status {
				t.Fatalf("status=%d want=%d", recorder.Code, tc.status)
			}
			if ping.calls != tc.calls {
				t.Fatalf("DB checks=%d want=%d", ping.calls, tc.calls)
			}
			if strings.Contains(recorder.Body.String(), "secret") {
				t.Fatal("health response leaked database detail")
			}
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("health response must not be cached")
			}
		})
	}
}
