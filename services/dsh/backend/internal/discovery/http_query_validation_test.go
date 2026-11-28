package discovery

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Reject unsupported or repeated public selectors before opening an owner
// transaction. Query aliases must never silently change Store/Offer scope.
func TestPublicStoreAndOfferQueriesRejectUnknownOrDuplicateSelectors(t *testing.T) {
	for _, tc := range []struct {
		name string
		path string
	}{
		{"store unknown", "/v1/public/stores?city_id=sanaa&actorId=someone"},
		{"store duplicate city", "/v1/public/stores?city_id=sanaa&city_id=aden"},
		{"store duplicate limit", "/v1/public/stores?city_id=sanaa&limit=1&limit=2"},
		{"store duplicate cursor", "/v1/public/stores?city_id=sanaa&cursor=one&cursor=two"},
		{"store alias", "/v1/public/stores?city_id=sanaa&category=grocery"},
		{"offer city override", "/v1/public/stores/store-a/offers?city_id=aden"},
		{"offer vertical override", "/v1/public/stores/store-a/offers?vertical_id=grocery"},
		{"offer duplicate limit", "/v1/public/stores/store-a/offers?limit=1&limit=2"},
		{"offer duplicate cursor", "/v1/public/stores/store-a/offers?cursor=one&cursor=two"},
		{"offer arbitrary", "/v1/public/stores/store-a/offers?actorId=other"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writer := httptest.NewRecorder()
			(&Server{Owner: &Owner{}}).ServeHTTP(writer,
				httptest.NewRequest(http.MethodGet, tc.path, nil))
			if writer.Code != http.StatusBadRequest ||
				!strings.Contains(writer.Body.String(), "INVALID_REQUEST") {
				t.Fatalf("unexpected selector reached owner: %s => %d %s",
					tc.path, writer.Code, writer.Body.String())
			}
		})
	}
}

func TestPublicDirectoriesRejectExplicitEmptyPagingSelectors(t *testing.T) {
	for _, path := range []string{
		"/v1/public/cities?limit=",
		"/v1/public/verticals?city_id=sanaa&limit=",
		"/v1/public/verticals?city_id=sanaa&cursor=",
		"/v1/public/stores?city_id=sanaa&limit=",
		"/v1/public/stores?city_id=sanaa&cursor=",
		"/v1/public/stores/store-a/offers?limit=",
		"/v1/public/stores/store-a/offers?cursor=",
	} {
		t.Run(path, func(t *testing.T) {
			writer := httptest.NewRecorder()
			(&Server{Owner: &Owner{}}).ServeHTTP(writer,
				httptest.NewRequest(http.MethodGet, path, nil))
			if writer.Code != http.StatusBadRequest {
				t.Fatalf("explicit empty paging value reached owner: %s => %d %s",
					path, writer.Code, writer.Body.String())
			}
		})
	}
}

func TestPublicReadsRejectUnsupportedRequestEnvelopes(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		chunked          bool
	}{
		{"detail unknown selector", "/v1/public/stores/store-a?actorId=other", "", false},
		{"detail empty query", "/v1/public/stores/store-a?", "", false},
		{"detail duplicate selector", "/v1/public/stores/store-a?city_id=a&city_id=b", "", false},
		{"cities body", "/v1/public/cities", "{}", false},
		{"verticals body", "/v1/public/verticals?city_id=sanaa", "{}", false},
		{"stores body", "/v1/public/stores?city_id=sanaa", "{}", false},
		{"detail body", "/v1/public/stores/store-a", "{}", false},
		{"offers body", "/v1/public/stores/store-a/offers", "{}", false},
		{"estimate body", "/v1/public/stores/store-a/offers/offer-a/estimate?quantity=1", "{}", false},
		{"chunked body", "/v1/public/stores/store-a", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, tc.path, strings.NewReader(tc.body))
			if tc.chunked {
				r.ContentLength = -1
				r.TransferEncoding = []string{"chunked"}
			}
			w := httptest.NewRecorder()
			(&Server{}).ServeHTTP(w, r)
			if w.Code != http.StatusBadRequest || w.Body.String() != "{\"error\":\"INVALID_REQUEST\"}\n" {
				t.Fatalf("malformed public request reached owner: %d %s", w.Code, w.Body.String())
			}
		})
	}
	for _, path := range []string{
		"/v1/public/cities", "/v1/public/verticals?city_id=sanaa",
		"/v1/public/stores?city_id=sanaa", "/v1/public/stores/store-a",
		"/v1/public/stores/store-a/offers",
		"/v1/public/stores/store-a/offers/offer-a/estimate?quantity=1",
	} {
		w := httptest.NewRecorder()
		(&Server{}).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("valid request failed to reach owner: %s => %d %s", path, w.Code, w.Body.String())
		}
	}
}

func TestPublicHTTPRouteAdmission(t *testing.T) {
	const origin = "http://localhost:18101"
	server := &Server{AllowedOrigins: map[string]bool{origin: true}}
	routes := []string{
		"/v1/public/cities", "/v1/public/verticals?city_id=sanaa",
		"/v1/public/stores?city_id=sanaa", "/v1/public/stores/store-a",
		"/v1/public/stores/store-a/offers", "/v1/public/stores/store-a/offers/offer-a/estimate?quantity=1",
	}
	for _, path := range routes {
		t.Run("valid "+path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodOptions, path, nil)
			req.Header.Set("Origin", origin)
			req.Header.Set("Access-Control-Request-Method", http.MethodGet)
			req.Header.Set("Access-Control-Request-Headers", "accept, content-type")
			w := httptest.NewRecorder()
			server.ServeHTTP(w, req)
			if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != origin || w.Header().Get("Access-Control-Allow-Methods") != "GET" || w.Header().Get("Cache-Control") != "no-store" || w.Body.Len() != 0 {
				t.Fatalf("valid preflight: %d %v %s", w.Code, w.Header(), w.Body)
			}
			for _, key := range []string{"Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"} {
				if !strings.Contains(w.Header().Get("Vary"), key) {
					t.Errorf("missing Vary %s", key)
				}
			}
			get := httptest.NewRequest(http.MethodGet, path, nil)
			get.Header.Set("Origin", origin)
			w = httptest.NewRecorder()
			server.ServeHTTP(w, get)
			if w.Code != 503 || w.Header().Get("Access-Control-Allow-Origin") != origin || w.Header().Get("Access-Control-Allow-Methods") != "" {
				t.Fatalf("valid GET owner unavailable: %d %v", w.Code, w.Header())
			}
		})
	}
	cases := []struct {
		name, path                string
		origins, methods, headers []string
		body                      string
	}{
		{"unknown route", "/v1/public/missing", []string{origin}, []string{"GET"}, nil, ""},
		{"unsupported method", routes[0], []string{origin}, []string{"DELETE"}, nil, ""},
		{"head not admitted", routes[0], []string{origin}, []string{"HEAD"}, nil, ""},
		{"missing method", routes[0], []string{origin}, nil, nil, ""},
		{"duplicate method", routes[0], []string{origin}, []string{"GET", "GET"}, nil, ""},
		{"missing origin", routes[0], nil, []string{"GET"}, nil, ""},
		{"duplicate origin", routes[0], []string{origin, origin}, []string{"GET"}, nil, ""},
		{"untrusted origin", routes[0], []string{"https://foreign.invalid"}, []string{"GET"}, nil, ""},
		{"null origin", routes[0], []string{"null"}, []string{"GET"}, nil, ""},
		{"unsupported header", routes[0], []string{origin}, []string{"GET"}, []string{"x-admin"}, ""},
		{"mixed header", routes[0], []string{origin}, []string{"GET"}, []string{"accept", "authorization"}, ""},
		{"empty header", routes[0], []string{origin}, []string{"GET"}, []string{""}, ""},
		{"trailing slash", "/v1/public/cities/", []string{origin}, []string{"GET"}, nil, ""},
		{"encoded route", "/v1/public/%63ities", []string{origin}, []string{"GET"}, nil, ""},
		{"malformed Store ID", "/v1/public/stores/bad%2Fid", []string{origin}, []string{"GET"}, nil, ""},
		{"preflight body", routes[0], []string{origin}, []string{"GET"}, nil, "{}"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodOptions, tc.path, strings.NewReader(tc.body))
			for _, value := range tc.origins {
				req.Header.Add("Origin", value)
			}
			for _, value := range tc.methods {
				req.Header.Add("Access-Control-Request-Method", value)
			}
			for _, value := range tc.headers {
				req.Header.Add("Access-Control-Request-Headers", value)
			}
			w := httptest.NewRecorder()
			server.ServeHTTP(w, req)
			if w.Code != 403 || w.Header().Get("Access-Control-Allow-Methods") != "" || w.Header().Get("Access-Control-Allow-Headers") != "" {
				t.Fatalf("invalid preflight admitted: %d %v", w.Code, w.Header())
			}
		})
	}
	for _, path := range []string{"/v1/public/cities/", "/v1/public/%63ities", "/v1/public/stores/bad%2Fid"} {
		t.Run("noncanonical GET "+path, func(t *testing.T) {
			w := httptest.NewRecorder()
			server.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
			if w.Code != 404 {
				t.Fatalf("noncanonical route reached owner: %d", w.Code)
			}
		})
	}
}

func TestPublicHTTPRouteAdmissionOverWire(t *testing.T) {
	const origin = "http://localhost:18101"
	server := httptest.NewServer(&Server{AllowedOrigins: map[string]bool{origin: true}})
	defer server.Close()
	for _, tc := range []struct {
		name, path, method, origin, requested, headers string
		status                                         int
		allowOrigin, allowMethod                       string
	}{
		{"valid preflight without extra headers", "/v1/public/cities", "OPTIONS", origin, "GET", "", 204, origin, "GET"},
		{"valid header names", "/v1/public/stores/store-a/offers", "OPTIONS", origin, "GET", "AcCePt, Content-Type", 204, origin, "GET"},
		{"unknown endpoint", "/v1/public/missing", "OPTIONS", origin, "GET", "", 403, "", ""},
		{"unsupported method", "/v1/public/cities", "OPTIONS", origin, "POST", "", 403, "", ""},
		{"unsupported header", "/v1/public/cities", "OPTIONS", origin, "GET", "authorization", 403, "", ""},
		{"detail query is not admitted", "/v1/public/stores/store-a?actor=other", "OPTIONS", origin, "GET", "", 403, "", ""},
		{"bounded request", "/v1/public/cities?" + strings.Repeat("q", 4097), "OPTIONS", origin, "GET", "", 403, "", ""},
		{"allowed public read", "/v1/public/cities", "GET", origin, "", "", 503, origin, ""},
		{"non-browser public read", "/v1/public/cities", "GET", "", "", "", 503, "", ""},
		{"foreign browser has no CORS grant", "/v1/public/cities", "GET", "https://foreign.invalid", "", "", 503, "", ""},
		{"wrong actual method", "/v1/public/cities", "POST", origin, "", "", 405, origin, ""},
		{"noncanonical escaped path", "/v1/public/%63ities", "GET", origin, "", "", 404, origin, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(tc.method, server.URL+tc.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.requested != "" {
				req.Header.Set("Access-Control-Request-Method", tc.requested)
			}
			if tc.headers != "" {
				req.Header.Set("Access-Control-Request-Headers", tc.headers)
			}
			resp, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tc.status || resp.Header.Get("Access-Control-Allow-Origin") != tc.allowOrigin ||
				resp.Header.Get("Access-Control-Allow-Methods") != tc.allowMethod || resp.Header.Get("Cache-Control") != "no-store" ||
				resp.Header.Get("Access-Control-Allow-Credentials") != "" {
				t.Fatalf("unexpected wire response: %d %v", resp.StatusCode, resp.Header)
			}
			if tc.status == 405 && resp.Header.Get("Allow") != "GET" {
				t.Fatalf("missing method contract: %v", resp.Header)
			}
			if tc.method == "OPTIONS" && tc.status == 403 && resp.Header.Get("Access-Control-Allow-Headers") != "" {
				t.Fatalf("denied header grant: %v", resp.Header)
			}
		})
	}
}
