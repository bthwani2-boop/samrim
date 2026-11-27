package wallet

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const merchantDecisionPath = "/v1/merchants/stores/store-a/commercial-agreement/decisions"
const financeDecisionPath = "/v1/operators/stores/store-a/commercial-agreement/decisions"
const validDecisionBody = `{"version":1,"proposalOperationId":"proposal-001","operationId":"decision-001","decision":"ACCEPTED","reason":"موافقة"}`

func decisionRequest(path, body string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+strings.Repeat("A", 43))
	r.Header.Set("Content-Type", "application/json")
	return r
}

func TestAgreementDecisionAdmission(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		adjust           func(*http.Request)
		status           int
	}{
		{"valid merchant", merchantDecisionPath, validDecisionBody, nil, 200},
		{"valid finance", financeDecisionPath, strings.Replace(validDecisionBody, "ACCEPTED", "FINANCE_APPROVED", 1), nil, 200},
		{"wrong stage", financeDecisionPath, validDecisionBody, nil, 400},
		{"wrong method", merchantDecisionPath, validDecisionBody, func(r *http.Request) { r.Method = "GET" }, 405},
		{"missing authorization", merchantDecisionPath, validDecisionBody, func(r *http.Request) { r.Header.Del("Authorization") }, 401},
		{"duplicate authorization", merchantDecisionPath, validDecisionBody, func(r *http.Request) { r.Header.Add("Authorization", r.Header.Get("Authorization")) }, 401},
		{"query", merchantDecisionPath + "?actorId=other", validDecisionBody, nil, 400},
		{"empty query", merchantDecisionPath + "?", validDecisionBody, nil, 400},
		{"invalid store", strings.Replace(merchantDecisionPath, "store-a", "..", 1), validDecisionBody, nil, 400},
		{"encoded store", strings.Replace(merchantDecisionPath, "store-a", "%73tore-a", 1), validDecisionBody, nil, 400},
		{"double slash", strings.Replace(merchantDecisionPath, "/stores/", "/stores//", 1), validDecisionBody, nil, 400},
		{"unknown member", merchantDecisionPath, strings.Replace(validDecisionBody, "{", `{"actorId":"other",`, 1), nil, 400},
		{"duplicate member", merchantDecisionPath, strings.Replace(validDecisionBody, "{", `{"version":2,`, 1), nil, 400},
		{"case variant", merchantDecisionPath, strings.Replace(validDecisionBody, "version", "Version", 1), nil, 400},
		{"null reason", merchantDecisionPath, strings.Replace(validDecisionBody, `"موافقة"`, "null", 1), nil, 400},
		{"unsafe version", merchantDecisionPath, strings.Replace(validDecisionBody, `"version":1`, `"version":9007199254740992`, 1), nil, 400},
		{"fractional version", merchantDecisionPath, strings.Replace(validDecisionBody, `"version":1`, `"version":1.5`, 1), nil, 400},
		{"invalid unicode", merchantDecisionPath, strings.Replace(validDecisionBody, `"موافقة"`, `"\ud800"`, 1), nil, 400},
		{"second document", merchantDecisionPath, validDecisionBody + " {}", nil, 400},
		{"oversized", merchantDecisionPath, validDecisionBody + strings.Repeat(" ", 4096), nil, 400},
		{"wrong content type", merchantDecisionPath, validDecisionBody, func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }, 400},
		{"wrong charset", merchantDecisionPath, validDecisionBody, func(r *http.Request) { r.Header.Set("Content-Type", "application/json; charset=latin1") }, 400},
		{"encoding", merchantDecisionPath, validDecisionBody, func(r *http.Request) { r.Header.Set("Content-Encoding", "gzip") }, 400},
		{"wrong length", merchantDecisionPath, validDecisionBody, func(r *http.Request) { r.ContentLength++ }, 400},
		{"chunked", merchantDecisionPath, validDecisionBody, func(r *http.Request) { r.ContentLength = -1; r.TransferEncoding = []string{"chunked"} }, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls int
			exec := func(_ context.Context, token string, d AgreementDecision) (string, error) {
				calls++
				if token != strings.Repeat("A", 43) || d.StoreID != "store-a" || d.Version != 1 || d.ProposalOperationID != "proposal-001" || d.OperationID != "decision-001" || d.Reason != "موافقة" {
					t.Fatalf("incorrect command admission %+v", d)
				}
				return "RECORDED", nil
			}
			r := decisionRequest(tc.path, tc.body)
			if tc.adjust != nil {
				tc.adjust(r)
			}
			rec := httptest.NewRecorder()
			agreementCommandRoutes(exec, exec, nil).ServeHTTP(rec, r)
			wantCalls := 0
			if tc.status == 200 {
				wantCalls = 1
			}
			if rec.Code != tc.status || calls != wantCalls || rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d calls=%d response=%s", rec.Code, calls, rec.Body.String())
			}
			if tc.status == 200 {
				var receipt agreementDecisionReceipt
				if json.Unmarshal(rec.Body.Bytes(), &receipt) != nil || receipt != (agreementDecisionReceipt{StoreID: "store-a", Version: 1, ProposalOperationID: "proposal-001", OperationID: "decision-001", State: "RECORDED"}) {
					t.Fatalf("invalid receipt %s", rec.Body.String())
				}
			}
		})
	}
}

func TestAgreementDecisionOwnerOutcomes(t *testing.T) {
	for _, tc := range []struct {
		name, state string
		err         error
		code        int
		public      string
	}{
		{"recorded", "RECORDED", nil, 200, ""},
		{"replayed", "REPLAYED", nil, 200, ""},
		{"invalid", "", ErrAgreementInvalid, 400, "INVALID_REQUEST"},
		{"unauthorized", "", ErrAgreementUnauthorized, 401, "UNAUTHORIZED"},
		{"forbidden", "", ErrAgreementForbidden, 403, "FORBIDDEN"},
		{"conflict", "", ErrAgreementConflict, 409, "DECISION_CONFLICT"},
		{"uncertain", "", ErrAgreementUnconfirmed, 503, "DECISION_UNCONFIRMED"},
		{"unexpected", "", errors.New("private database detail"), 503, "DECISION_UNCONFIRMED"},
		{"invalid state", "ACTIVE", nil, 503, "DECISION_UNCONFIRMED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exec := func(_ context.Context, _ string, _ AgreementDecision) (string, error) { return tc.state, tc.err }
			rec := httptest.NewRecorder()
			agreementCommandRoutes(exec, nil, nil).ServeHTTP(rec, decisionRequest(merchantDecisionPath, validDecisionBody))
			if rec.Code != tc.code {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if tc.code != 200 {
				var body map[string]string
				if json.Unmarshal(rec.Body.Bytes(), &body) != nil || len(body) != 1 || body["error"] != tc.public {
					t.Fatalf("unexpected public error %s", rec.Body.String())
				}
			}
		})
	}
}

func TestAgreementDecisionCancellationAndReadOnlyBoundary(t *testing.T) {
	calls := 0
	exec := func(_ context.Context, _ string, _ AgreementDecision) (string, error) {
		calls++
		return "RECORDED", nil
	}
	r := decisionRequest(merchantDecisionPath, validDecisionBody)
	ctx, cancel := context.WithCancel(r.Context())
	cancel()
	rec := httptest.NewRecorder()
	agreementCommandRoutes(exec, exec, nil).ServeHTTP(rec, r.WithContext(ctx))
	if rec.Code != 503 || calls != 0 {
		t.Fatalf("cancelled command reached owner %d %d", rec.Code, calls)
	}
	readonly, err := newHandler("http://127.0.0.1:1", nil)
	if err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	readonly.ServeHTTP(rec, decisionRequest(merchantDecisionPath, validDecisionBody))
	if rec.Code != 404 {
		t.Fatalf("decision exposed by read-only owner %d", rec.Code)
	}
	if handler, err := NewIsolatedAgreementCommandHandler(nil, "http://127.0.0.1:1", "http://127.0.0.1:2"); err == nil || handler != nil {
		t.Fatal("missing command principal accepted")
	}
}
