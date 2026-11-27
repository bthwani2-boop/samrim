package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPrivateOwnerCORSContract(t *testing.T) {
	t.Setenv("DSH_LISTEN_ADDR", "127.0.0.1:18080")
	t.Setenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY", "true")
	t.Setenv("BTHWANI_ISOLATED_TEST_MODE", "true")
	t.Setenv("DSH_IDENTITY_VERIFIER_URL", "http://127.0.0.1:3302")
	t.Setenv("DSH_ENABLE_ISOLATED_CAPTAIN_STANDING", "true")
	t.Setenv("DSH_ENABLE_ISOLATED_CAPTAIN_INTEREST", "true")
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	const origin = "http://127.0.0.1:13000"
	const store = "/v1/stores/store-a/availability"
	const city = "/v1/operators/cities/sanaa/store-availability-policy"
	const preview = "/v1/operators/cities/sanaa/delivery-policy/preview"
	const captain = "/v1/captains/me/standing"
	origins := map[string]bool{origin: true}
	public := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	handler, err := isolatedStoreAvailabilityHandler(db, "dsh_test_cors", public, origins)
	if err != nil {
		t.Fatal(err)
	}
	handler, err = isolatedCaptainStandingHandler(db, "dsh_test_cors", handler, origins)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	for _, tc := range []struct {
		name, path, method        string
		origins, methods, headers []string
		status                    int
		approved                  bool
	}{
		{"store read", store, "OPTIONS", []string{origin}, []string{"GET"}, []string{"authorization"}, 204, true},
		{"store patch", store, "OPTIONS", []string{origin}, []string{"PATCH"}, []string{"authorization, content-type"}, 204, true},
		{"store post rejected", store, "OPTIONS", []string{origin}, []string{"POST"}, nil, 403, false},
		{"city read", city, "OPTIONS", []string{origin}, []string{"GET"}, []string{"Authorization"}, 204, true},
		{"city patch", city, "OPTIONS", []string{origin}, []string{"PATCH"}, []string{"Authorization", "Content-Type"}, 204, true},
		{"delivery preview", preview, "OPTIONS", []string{origin}, []string{"POST"}, []string{"authorization, content-type"}, 204, true},
		{"city delete rejected", city, "OPTIONS", []string{origin}, []string{"DELETE"}, nil, 403, false},
		{"preview patch rejected", preview, "OPTIONS", []string{origin}, []string{"PATCH"}, nil, 403, false},
		{"preview get rejected", preview, "OPTIONS", []string{origin}, []string{"GET"}, nil, 403, false},
		{"missing route", city + "/unknown", "OPTIONS", []string{origin}, []string{"GET"}, nil, 403, false},
		{"implicit head rejected", city, "OPTIONS", []string{origin}, []string{"HEAD"}, nil, 403, false},
		{"foreign origin", city, "OPTIONS", []string{"http://evil.invalid"}, []string{"GET"}, nil, 403, false},
		{"null origin", city, "OPTIONS", []string{"null"}, []string{"GET"}, nil, 403, false},
		{"duplicate origin", city, "OPTIONS", []string{origin, origin}, []string{"GET"}, nil, 403, false},
		{"duplicate method", city, "OPTIONS", []string{origin}, []string{"GET", "PATCH"}, nil, 403, false},
		{"untrusted repeated header", city, "OPTIONS", []string{origin}, []string{"GET"}, []string{"authorization", "x-admin"}, 403, false},
		{"empty method", city, "OPTIONS", []string{origin}, nil, nil, 403, false},
		{"captain read", captain, "OPTIONS", []string{origin}, []string{"GET"}, []string{"authorization"}, 204, true},
		{"captain delete denied", captain, "OPTIONS", []string{origin}, []string{"DELETE"}, nil, 403, false},
		{"captain patch denied", captain, "OPTIONS", []string{origin}, []string{"PATCH"}, nil, 403, false},
		{"captain post denied", captain, "OPTIONS", []string{origin}, []string{"POST"}, nil, 403, false},
		{"eligibility read", "/v1/actors/me/captain-eligibility", "OPTIONS", []string{origin}, []string{"GET"}, nil, 204, true},
		{"eligibility post denied", "/v1/actors/me/captain-eligibility", "OPTIONS", []string{origin}, []string{"POST"}, nil, 403, false},
		{"application read", "/v1/actors/me/captain-application", "OPTIONS", []string{origin}, []string{"GET"}, nil, 204, true},
		{"application post", "/v1/actors/me/captain-application", "OPTIONS", []string{origin}, []string{"POST"}, nil, 204, true},
		{"application patch denied", "/v1/actors/me/captain-application", "OPTIONS", []string{origin}, []string{"PATCH"}, nil, 403, false},
		{"operator captain list", "/v1/operators/captains", "OPTIONS", []string{origin}, []string{"GET"}, nil, 204, true},
		{"operator captain list patch denied", "/v1/operators/captains", "OPTIONS", []string{origin}, []string{"PATCH"}, nil, 403, false},
		{"operator captain detail", "/v1/operators/captains/captain-17/standing", "OPTIONS", []string{origin}, []string{"GET"}, nil, 204, true},
		{"operator captain change", "/v1/operators/captains/captain-17/standing", "OPTIONS", []string{origin}, []string{"PATCH"}, nil, 204, true},
		{"operator captain post denied", "/v1/operators/captains/captain-17/standing", "OPTIONS", []string{origin}, []string{"POST"}, nil, 403, false},
		{"operator unknown route", "/v1/operators/captains/captain-17/unknown", "OPTIONS", []string{origin}, []string{"GET"}, nil, 403, false},
		{"operator malformed actor", "/v1/operators/captains/bad%2Fid/standing", "OPTIONS", []string{origin}, []string{"GET"}, nil, 403, false},
		{"interest submission", "/v1/captain-interest", "OPTIONS", []string{origin}, []string{"POST"}, nil, 204, true},
		{"interest read denied", "/v1/captain-interest", "OPTIONS", []string{origin}, []string{"GET"}, nil, 403, false},
		{"interest review", "/v1/operators/captain-interest", "OPTIONS", []string{origin}, []string{"GET"}, nil, 204, true},
		{"interest list post denied", "/v1/operators/captain-interest", "OPTIONS", []string{origin}, []string{"POST"}, nil, 403, false},
		{"interest contact", "/v1/operators/captain-interest/42/contact", "OPTIONS", []string{origin}, []string{"PATCH"}, nil, 204, true},
		{"interest invalid contact", "/v1/operators/captain-interest/invalid/contact", "OPTIONS", []string{origin}, []string{"PATCH"}, nil, 403, false},
		{"interest contact read denied", "/v1/operators/captain-interest/42/contact", "OPTIONS", []string{origin}, []string{"GET"}, nil, 403, false},
		{"interest missing route", "/v1/operators/captain-interest/42/unknown", "OPTIONS", []string{origin}, []string{"PATCH"}, nil, 403, false},
		{"anonymous preview", preview, "POST", []string{origin}, nil, nil, 401, false},
		{"anonymous store", store, "GET", []string{origin}, nil, nil, 401, false},
		{"anonymous city", city, "PATCH", []string{origin}, nil, nil, 401, false},
		{"anonymous captain", captain, "GET", []string{origin}, nil, nil, 401, false},
		{"anonymous no origin", city, "GET", nil, nil, nil, 401, false},
		{"actual foreign origin", city, "GET", []string{"http://evil.invalid"}, nil, nil, 403, false},
		{"actual duplicate origin", city, "GET", []string{origin, origin}, nil, nil, 403, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(tc.method, server.URL+tc.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			for _, value := range tc.origins {
				req.Header.Add("Origin", value)
			}
			for _, value := range tc.methods {
				req.Header.Add("Access-Control-Request-Method", value)
			}
			for _, value := range tc.headers {
				req.Header.Add("Access-Control-Request-Headers", value)
			}
			rec, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer rec.Body.Close()
			if rec.StatusCode != tc.status {
				t.Errorf("status=%d want=%d", rec.StatusCode, tc.status)
			}
			if rec.Header.Get("Cache-Control") != "no-store" {
				t.Error("private response cacheable")
			}
			if rec.Header.Get("Access-Control-Allow-Credentials") != "" {
				t.Error("cookie credentials exposed")
			}
			if tc.approved {
				if rec.Header.Get("Access-Control-Allow-Origin") != origin || rec.Header.Get("Access-Control-Allow-Methods") != tc.methods[0] {
					t.Errorf("incorrect preflight response: %v", rec.Header)
				}
				if rec.Header.Get("Access-Control-Allow-Headers") != "Authorization, Content-Type" {
					t.Error("wrong header policy")
				}
			} else if tc.method == "OPTIONS" && rec.Header.Get("Access-Control-Allow-Methods") != "" {
				t.Error("denied preflight advertised methods")
			}
			if (len(tc.origins) > 1 || (len(tc.origins) == 1 && tc.origins[0] != origin)) && rec.Header.Get("Access-Control-Allow-Origin") != "" {
				t.Error("untrusted origin admitted")
			}
		})
	}
}
