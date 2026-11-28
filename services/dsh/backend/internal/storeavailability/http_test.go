package storeavailability

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPRequiresVerifiedAuthAndRejectsUnknownInput(t *testing.T) {
	count := 0
	s, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, fakeRepo{&count})
	handler, err := NewHandler(s)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, method, body, token string
		want                      int
	}{
		{"unauthenticated GET", "GET", "", "", 401},
		{"unauthenticated PATCH", "PATCH", `{}`, "", 401},
		{"invalid JWT header", "GET", "", "Bearer whitespace token", 401},
		{"unknown field", "PATCH", `{"operationId":"merchant-0001","admin":true}`, "Bearer valid-token", 400},
		{"duplicate operation identity", "PATCH", `{"operationId":"merchant-0001","OperationID":"merchant-0002","expectedVersion":1,"weekly":[{"weekday":1,"opens":600,"closes":1200}],"preparationMinutes":25,"reason":"Schedule update"}`, "Bearer valid-token", 400},
		{"duplicate nested schedule selector", "PATCH", `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[{"weekday":1,"Weekday":2,"opens":600,"closes":1200}],"preparationMinutes":25,"reason":"Schedule update"}`, "Bearer valid-token", 400},
		{"invalid JSON", "PATCH", `{"operationId":`, "Bearer valid-token", 400},
		{"oversized request", "PATCH", strings.Repeat("x", 20*1024), "Bearer valid-token", 400},
		{"JSON trailing text", "PATCH", `{}{"another":1}`, "Bearer valid-token", 400},
		{"missing version", "PATCH", `{}`, "Bearer valid-token", 400},
		{"unsupported content type", "PATCH", `{}`, "Bearer valid-token", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/v1/stores/store-one/availability", strings.NewReader(tc.body))
			if tc.token != "" {
				req.Header.Set("Authorization", tc.token)
			}
			if tc.method == "PATCH" && tc.name != "unsupported content type" {
				req.Header.Set("Content-Type", "application/json")
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got %d want %d body %s", w.Code, tc.want, w.Body.String())
			}
			if got := w.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("expected no-store, got %q", got)
			}
		})
	}
	if count != 0 {
		t.Fatalf("unauthorized input mutated owner %d times", count)
	}
	duplicate := httptest.NewRequest("GET", "/v1/stores/store-one/availability", nil)
	duplicate.Header.Add("Authorization", "Bearer token-one")
	duplicate.Header.Add("Authorization", "Bearer token-two")
	duplicateResult := httptest.NewRecorder()
	handler.ServeHTTP(duplicateResult, duplicate)
	if duplicateResult.Code != http.StatusUnauthorized {
		t.Fatalf("duplicate authorization header returned %d", duplicateResult.Code)
	}
}

// Each of the Store, city-policy, and registration adapters uses the same
// bounded strict parser before invoking its DSH owner writer.
func TestDecodeUniqueJSONRejectsAmbiguousAndOversizeChanges(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		limit      int64
		valid      bool
	}{
		{"valid bounded object", `{"operationId":"merchant-0001","expectedVersion":1}`, 128, true},
		{"duplicate exact", `{"operationId":"first","operationId":"second"}`, 128, false},
		{"duplicate case-insensitive", `{"operationId":"first","OperationID":"second"}`, 128, false},
		{"nested duplicate", `{"weekly":[{"weekday":1,"Weekday":2}]}`, 128, false},
		{"trailing document", `{"operationId":"first"} {}`, 128, false},
		{"unknown field", `{"operationId":"first","unexpected":1}`, 128, false},
		{"oversized", `{"operationId":"first"}`, 5, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, "/v1/stores/store-one/availability", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			res := httptest.NewRecorder()
			var input struct {
				OperationID     string `json:"operationId"`
				ExpectedVersion int64  `json:"expectedVersion"`
				Weekly          []struct {
					Weekday int `json:"weekday"`
				} `json:"weekly"`
			}
			err := decodeUniqueJSON(res, req, tc.limit, &input)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
			if tc.valid && (input.OperationID != "merchant-0001" || input.ExpectedVersion != 1) {
				t.Fatalf("validated object corrupted: %+v", input)
			}
		})
	}
}

func TestHTTPResponseUsesStableNoSecretErrorCodes(t *testing.T) {
	deny := fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}
	count := 0
	s, _ := NewService(deny, fakeGrant{denied: true}, fakePolicy{}, fakeRepo{&count})
	handler, _ := NewHandler(s)
	req := httptest.NewRequest("GET", "/v1/stores/not-owned/availability", nil)
	req.Header.Set("Authorization", "Bearer sentinel")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatal(w.Code)
	}
	var resp struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Code != "STORE_OPERATION_FORBIDDEN" {
		t.Fatalf("resp %+v err %v", resp, err)
	}
	if bytes.Contains(w.Body.Bytes(), []byte("sentinel")) {
		t.Fatal("secret leaked")
	}
	if _, err := NewHandler(nil); err == nil {
		t.Fatal("handler started without owner service")
	}
}

func TestHTTPStoreOwnerOutageIsRecoverableWithoutDisclosure(t *testing.T) {
	count := 0
	s, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}},
		fakeGrant{unavailable: true}, fakePolicy{}, fakeRepo{&count})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewHandler(s)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[{"weekday":1,"opens":600,"closes":1200}],"preparationMinutes":25,"reason":"Schedule update"}`
	for _, method := range []string{http.MethodGet, http.MethodPatch} {
		req := httptest.NewRequest(method, "/v1/stores/store-one/availability", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer valid-token")
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusServiceUnavailable || !bytes.Contains(response.Body.Bytes(), []byte(`"code":"STORE_OWNER_UNAVAILABLE"`)) {
			t.Fatalf("%s Store owner outage returned %d: %s", method, response.Code, response.Body.String())
		}
		if bytes.Contains(response.Body.Bytes(), []byte("database unavailable")) || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s leaked or cached Store owner outage", method)
		}
	}
	if count != 0 {
		t.Fatalf("Store owner outage reached persistence %d times", count)
	}
}

func TestHTTPAcceptsOneScopedValidatedUpdate(t *testing.T) {
	count := 0
	s, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, fakeRepo{&count})
	handler, _ := NewHandler(s)
	body := `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[{"weekday":1,"opens":600,"closes":1200}],"preparationMinutes":25,"reason":"Schedule update"}`
	for _, contentType := range []string{"application/json", "application/json; charset=utf-8"} {
		req := httptest.NewRequest("PATCH", "/v1/stores/store-one/availability", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer validated-token")
		req.Header.Set("Content-Type", contentType)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("content type %s got %d body %s", contentType, w.Code, w.Body.String())
		}
		var result struct {
			Availability Snapshot `json:"availability"`
			Replay       bool     `json:"replay"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Replay || result.Availability.Version != 2 {
			t.Fatalf("%+v %v", result, err)
		}
	}
	if count != 2 {
		t.Fatalf("expected two validated changes, count %d", count)
	}
}

func TestHTTPPolicyVersionConflictHasStableNonSecretCode(t *testing.T) {
	w := httptest.NewRecorder()
	writeFailure(w, ErrPolicyVersionConflict)
	if w.Code != http.StatusConflict {
		t.Fatalf("policy version conflict returned HTTP %d", w.Code)
	}
	var response struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.Code != "OPERATIONAL_POLICY_VERSION_CONFLICT" {
		t.Fatalf("unexpected policy conflict response: %+v err=%v", response, err)
	}
}

// A PATCH is a full replacement of operational fields. Missing schedule or
// preparation must never silently clear a published Store's hours or ETA.
func TestHTTPRejectsImplicitReplacementDefaults(t *testing.T) {
	count := 0
	s, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, fakeRepo{&count})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewHandler(s)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct{ name, body string }{
		{"missing weekly", `{"operationId":"merchant-0001","expectedVersion":1,"preparationMinutes":25,"reason":"Pause only"}`},
		{"null weekly", `{"operationId":"merchant-0001","expectedVersion":1,"weekly":null,"preparationMinutes":25,"reason":"Pause only"}`},
		{"missing preparation", `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[{"weekday":1,"opens":600,"closes":1200}],"reason":"Schedule only"}`},
		{"null preparation", `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[],"preparationMinutes":null,"reason":"Pause only"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, "/v1/stores/store-one/availability", strings.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer valid-token")
			req.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, req)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("implicit replacement allowed HTTP %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
	if count != 0 {
		t.Fatalf("implicit replacement mutated the Store %d times", count)
	}
}

func TestCanonicalJSONRepresentation(t *testing.T) {
	for _, c := range []struct {
		name, body, media, encoding, query string
		valid                              bool
	}{
		{"valid", "{\"name\":\"abc\"}", "application/json", "", "", true},
		{"alias", "{\"Name\":\"abc\"}", "application/json", "", "", false},
		{"invalid unicode", "{\"name\":\"\\ud800\"}", "application/json", "", "", false},
		{"null", "null", "application/json", "", "", false},
		{"non-JSON whitespace", "\u00a0{\"name\":\"abc\"}", "application/json", "", "", false},
		{"charset", "{\"name\":\"abc\"}", "application/json; charset=latin1", "", "", false},
		{"encoded", "{\"name\":\"abc\"}", "application/json", "gzip", "", false},
		{"query", "{\"name\":\"abc\"}", "application/json", "", "?unexpected=1", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/fixture"+c.query, strings.NewReader(c.body))
			r.Header.Set("Content-Type", c.media)
			if c.encoding != "" {
				r.Header.Set("Content-Encoding", c.encoding)
			}
			var out struct {
				Name string `json:"name"`
			}
			err := decodeUniqueJSON(httptest.NewRecorder(), r, 1024, &out)
			if (err == nil) != c.valid {
				t.Fatalf("valid=%v error=%v", c.valid, err)
			}
		})
	}
}
func TestCanonicalDistanceBandRepresentation(t *testing.T) {
	for _, c := range []struct {
		raw   string
		valid bool
	}{
		{"[{\"upToMeters\":null,\"ratePerKmMinor\":1000}]", true},
		{"[{\"UpToMeters\":null,\"ratePerKmMinor\":1000}]", false},
		{"[{\"upToMeters\":null,\"RatePerKmMinor\":1000}]", false},
		{"[{\"ratePerKmMinor\":1000}]", false},
	} {
		if _, ok := DecodeDistanceBands([]byte(c.raw)); ok != c.valid {
			t.Errorf("valid=%v input=%s", c.valid, c.raw)
		}
	}
}

func TestRequiredCommandFieldsBeforeOwner(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	registrar := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, grants: &PostgresStoreGrants{db: db, schema: "dsh_test_presence"}}
	draft, _ := NewMerchantCatalogDraftHandler(registrar)
	edit, _ := NewMerchantCatalogEditHandler(registrar)
	imports, _ := NewMerchantCatalogImportHandler(registrar)
	policy, _ := NewStoreRegistrationPolicyHandler(&MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, grants: registrar.grants})
	count := 0
	service, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, fakeGrant{}, fakePolicy{}, fakeRepo{&count})
	availability, _ := NewHandler(service)
	mux := http.NewServeMux()
	mux.Handle("/draft/{storeID}", draft)
	mux.Handle("/edit/{storeID}/{offerID}", edit)
	mux.Handle("/imports/{storeID}/{runID}", imports)
	mux.Handle("/v1/operators/", policy)
	mux.Handle("/v1/stores/", availability)
	for _, c := range []struct {
		name, method, path, body string
		want                     int
	}{
		{"draft missing stock", "POST", "/draft/store-a", `{"operationId":"draft-0001","name":"Item","priceYer":"100"}`, 400},
		{"draft null stock", "POST", "/draft/store-a", `{"operationId":"draft-0001","name":"Item","priceYer":"100","stockUnits":null}`, 400},
		{"draft zero stock", "POST", "/draft/store-a", `{"operationId":"draft-0001","name":"Item","priceYer":"100","stockUnits":0}`, 503},
		{"edit missing stock", "PATCH", "/edit/store-a/offer-a", `{"operationId":"edit-0001","expectedVersion":1,"name":"Item","priceYer":"100"}`, 400},
		{"edit null stock", "PATCH", "/edit/store-a/offer-a", `{"operationId":"edit-0001","expectedVersion":1,"name":"Item","priceYer":"100","stockUnits":null}`, 400},
		{"edit zero stock", "PATCH", "/edit/store-a/offer-a", `{"operationId":"edit-0001","expectedVersion":1,"name":"Item","priceYer":"100","stockUnits":0}`, 503},
		{"policy missing enabled", "PATCH", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", `{"operationId":"policy-0001","expectedVersion":0,"termsVersion":"terms-v1","termsText":"Terms","reason":"Reason"}`, 400},
		{"policy null enabled", "PATCH", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", `{"operationId":"policy-0001","expectedVersion":0,"enabled":null,"termsVersion":"terms-v1","termsText":"Terms","reason":"Reason"}`, 400},
		{"policy missing version", "PATCH", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", `{"operationId":"policy-0001","enabled":false,"termsVersion":"terms-v1","termsText":"Terms","reason":"Reason"}`, 400},
		{"policy explicit false zero", "PATCH", "/v1/operators/cities/sanaa/store-registration-policy/MARKETPLACE", `{"operationId":"policy-0001","expectedVersion":0,"enabled":false,"termsVersion":"terms-v1","termsText":"Terms","reason":"Reason"}`, 503},
		{"schedule missing weekday", "PATCH", "/v1/stores/store-one/availability", `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[{"opens":600,"closes":1200}],"preparationMinutes":25,"reason":"Schedule update"}`, 400},
		{"schedule missing opens", "PATCH", "/v1/stores/store-one/availability", `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[{"weekday":1,"closes":1200}],"preparationMinutes":25,"reason":"Schedule update"}`, 400},
		{"schedule null weekday", "PATCH", "/v1/stores/store-one/availability", `{"operationId":"merchant-0001","expectedVersion":1,"weekly":[{"weekday":null,"opens":600,"closes":1200}],"preparationMinutes":25,"reason":"Schedule update"}`, 400},
		{"import missing name", "PUT", "/imports/store-a/import-0001", `{"sourceSha256":"` + strings.Repeat("a", 64) + `","rows":[{"row":2,"priceYer":"","stockUnits":""}]}`, 400},
		{"import null stock", "PUT", "/imports/store-a/import-0001", `{"sourceSha256":"` + strings.Repeat("a", 64) + `","rows":[{"row":2,"name":"","priceYer":"","stockUnits":null}]}`, 400},
		{"import explicit empty", "PUT", "/imports/store-a/import-0001", `{"sourceSha256":"` + strings.Repeat("a", 64) + `","rows":[{"row":2,"name":"","priceYer":"","stockUnits":""}]}`, 503},
	} {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Authorization", "Bearer synthetic")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			if w.Code != c.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, c.want, w.Body.String())
			}
		})
	}
	if count != 0 {
		t.Fatalf("invalid schedule reached owner %d times", count)
	}
}
