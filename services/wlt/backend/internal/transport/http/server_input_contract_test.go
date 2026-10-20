package http

import (
	"database/sql"
	nethttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServerConfigurationValidation(t *testing.T) {
	key := strings.Repeat("00", 32)

	if _, err := New(nil, "service-token", key, key); err == nil {
		t.Fatal("New accepted a nil database")
	}
	if _, err := New(&sql.DB{}, "  ", key, key); err == nil {
		t.Fatal("New accepted an empty service token")
	}
	if _, err := New(&sql.DB{}, "service-token", "invalid", key); err == nil {
		t.Fatal("New accepted an invalid destination encryption key")
	}
	if _, err := New(&sql.DB{}, "service-token", key); err == nil {
		t.Fatal("New accepted a missing finance evidence encryption key")
	}
	if _, err := New(&sql.DB{}, "service-token", key, "invalid"); err == nil {
		t.Fatal("New accepted an invalid finance evidence encryption key")
	}
	if server, err := New(&sql.DB{}, " service-token ", key, key); err != nil {
		t.Fatalf("New rejected valid configuration: %v", err)
	} else if server.serviceToken != "service-token" {
		t.Fatalf("service token was not normalized: %q", server.serviceToken)
	}
}

func TestCashInRailConfigurationGuard(t *testing.T) {
	if rail, enabled, err := cashInRailForConfig("", "production"); err != nil || rail != nil || enabled {
		t.Fatalf("empty Cash-In mode: rail=%T enabled=%v err=%v", rail, enabled, err)
	}
	if rail, enabled, err := cashInRailForConfig(" disabled ", "development"); err != nil || rail != nil || enabled {
		t.Fatalf("disabled Cash-In mode: rail=%T enabled=%v err=%v", rail, enabled, err)
	}
	if rail, enabled, err := cashInRailForConfig(" SIMULATOR ", " DEVELOPMENT "); err != nil || rail == nil || !enabled {
		t.Fatalf("development simulator: rail=%T enabled=%v err=%v", rail, enabled, err)
	}
	if _, _, err := cashInRailForConfig("simulator", "production"); err == nil {
		t.Fatal("Cash-In simulator was accepted outside development")
	}
	if _, _, err := cashInRailForConfig("unknown", "development"); err == nil {
		t.Fatal("unknown Cash-In rail mode was accepted")
	}
}

func TestMutationHeadersContract(t *testing.T) {
	request := httptest.NewRequest(nethttp.MethodPost, "/", nil)
	request.Header.Set("X-Correlation-ID", " correlation-123 ")
	request.Header.Set("Idempotency-Key", " idempotency-123 ")
	response := httptest.NewRecorder()

	correlation, idempotency, ok := mutationHeaders(response, request)
	if !ok {
		t.Fatal("mutationHeaders rejected valid headers")
	}
	if correlation != "correlation-123" || idempotency != "idempotency-123" {
		t.Fatalf("mutationHeaders did not normalize values: %q %q", correlation, idempotency)
	}
}

func TestMutationHeadersRejectInvalidLengths(t *testing.T) {
	cases := []struct {
		name        string
		correlation string
		idempotency string
	}{
		{name: "missing correlation", idempotency: "12345678"},
		{name: "short idempotency", correlation: "12345678", idempotency: "1234567"},
		{name: "long correlation", correlation: strings.Repeat("c", 129), idempotency: "12345678"},
		{name: "long idempotency", correlation: "12345678", idempotency: strings.Repeat("i", 129)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(nethttp.MethodPost, "/", nil)
			request.Header.Set("X-Correlation-ID", tc.correlation)
			request.Header.Set("Idempotency-Key", tc.idempotency)
			response := httptest.NewRecorder()

			if _, _, ok := mutationHeaders(response, request); ok {
				t.Fatal("mutationHeaders accepted invalid headers")
			}
			if response.Code != nethttp.StatusBadRequest {
				t.Fatalf("status: got %d, want %d", response.Code, nethttp.StatusBadRequest)
			}
		})
	}
}

func TestVersionedMutationHeadersContract(t *testing.T) {
	request := httptest.NewRequest(nethttp.MethodPost, "/", nil)
	request.Header.Set("X-Correlation-ID", "12345678")
	request.Header.Set("Idempotency-Key", "abcdefgh")
	request.Header.Set("X-Expected-Version", " 7 ")
	response := httptest.NewRecorder()

	correlation, idempotency, expected, ok := versionedMutationHeaders(response, request)
	if !ok || correlation != "12345678" || idempotency != "abcdefgh" || expected != 7 {
		t.Fatalf("valid versioned headers: correlation=%q idempotency=%q expected=%d ok=%v", correlation, idempotency, expected, ok)
	}
}

func TestVersionedMutationHeadersRejectInvalidVersion(t *testing.T) {
	for _, version := range []string{"", "0", "-1", "abc"} {
		t.Run("version="+version, func(t *testing.T) {
			request := httptest.NewRequest(nethttp.MethodPost, "/", nil)
			request.Header.Set("X-Correlation-ID", "12345678")
			request.Header.Set("Idempotency-Key", "abcdefgh")
			request.Header.Set("X-Expected-Version", version)
			response := httptest.NewRecorder()

			if _, _, _, ok := versionedMutationHeaders(response, request); ok {
				t.Fatal("versionedMutationHeaders accepted an invalid expected version")
			}
			if response.Code != nethttp.StatusBadRequest {
				t.Fatalf("status: got %d, want %d", response.Code, nethttp.StatusBadRequest)
			}
		})
	}
}

func TestDecodeJSONStrictContract(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}

	request := httptest.NewRequest(nethttp.MethodPost, "/", strings.NewReader(`{"name":"value"}`))
	response := httptest.NewRecorder()
	var value payload
	if !decodeJSON(response, request, &value) {
		t.Fatal("decodeJSON rejected a valid object")
	}
	if value.Name != "value" {
		t.Fatalf("decoded name: got %q, want value", value.Name)
	}
}

func TestDecodeJSONRejectsInvalidBodies(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}
	cases := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"name":"value","extra":true}`},
		{name: "multiple values", body: `{"name":"value"} {"name":"second"}`},
		{name: "malformed", body: `{"name":`},
		{name: "over size limit", body: `{"name":"` + strings.Repeat("x", 33*1024) + `"}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(nethttp.MethodPost, "/", strings.NewReader(tc.body))
			response := httptest.NewRecorder()
			var value payload

			if decodeJSON(response, request, &value) {
				t.Fatal("decodeJSON accepted an invalid body")
			}
			if response.Code != nethttp.StatusBadRequest {
				t.Fatalf("status: got %d, want %d", response.Code, nethttp.StatusBadRequest)
			}
		})
	}
}
