package wallet

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const proposalPath = "/v1/operators/stores/store-a/commercial-agreement/proposals"
const proposalBody = `{"expectedVersion":0,"operationId":"proposal-001","feeModel":"SUBSCRIPTION","collector":"STORE_MANAGED","subscriptionAmountYer":"9007199254740993","subscriptionPeriodDays":30,"fulfillmentModes":["CUSTOMER_PICKUP"],"proposedEffectiveAt":"2027-01-01T10:00:00.000001+03:00","reason":"مقترح"}`

func TestAgreementProposalHTTPAdmission(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		code             int
	}{
		{"success", proposalPath, proposalBody, 200},
		{"extra zero precision", proposalPath, strings.Replace(proposalBody, "000001", "0000010000", 1), 200},
		{"merchant path", strings.Replace(proposalPath, "/operators/", "/merchants/", 1), proposalBody, 400},
		{"caller actor", proposalPath, strings.Replace(proposalBody, "{", `{"actorId":"other",`, 1), 400},
		{"duplicate version", proposalPath, strings.Replace(proposalBody, "{", `{"expectedVersion":1,`, 1), 400},
		{"missing version", proposalPath, strings.Replace(proposalBody, `"expectedVersion":0,`, "", 1), 400},
		{"unsafe amount number", proposalPath, strings.Replace(proposalBody, `"9007199254740993"`, "9007199254740993", 1), 400},
		{"leading zero", proposalPath, strings.Replace(proposalBody, "9007199254740993", "09007199254740993", 1), 400},
		{"amount overflow", proposalPath, strings.Replace(proposalBody, "9007199254740993", "9223372036854775808", 1), 400},
		{"unsupported precision", proposalPath, strings.Replace(proposalBody, "000001", "000001001", 1), 400},
		{"unsupported precision past nanoseconds", proposalPath, strings.Replace(proposalBody, "000001", "0000010001", 1), 400},
		{"noncanonical offset minutes", proposalPath, strings.Replace(proposalBody, "+03:00", "+02:60", 1), 400},
		{"noncanonical decimal separator", proposalPath, strings.Replace(proposalBody, ".000001", ",000001", 1), 400},
		{"query", proposalPath + "?relation=DIRECT", proposalBody, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			propose := func(_ context.Context, token string, p AgreementProposal) (AgreementProposalReceipt, error) {
				calls++
				if token != strings.Repeat("A", 43) || p.StoreID != "store-a" || p.ExpectedVersion != 0 ||
					p.SubscriptionAmountYER == nil || *p.SubscriptionAmountYER != 9007199254740993 ||
					p.ProposedEffectiveAt.UTC().Hour() != 7 {
					t.Fatalf("unexpected proposal: %+v", p)
				}
				return AgreementProposalReceipt{Version: 1, Replay: true}, nil
			}
			rec := httptest.NewRecorder()
			agreementCommandRoutes(nil, nil, propose).ServeHTTP(rec, decisionRequest(tc.path, tc.body))
			if rec.Code != tc.code || rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("code=%d body=%s", rec.Code, rec.Body.String())
			}
			if tc.code != 200 {
				if calls != 0 {
					t.Fatal("invalid wire command reached WLT")
				}
				return
			}
			var result map[string]any
			if calls != 1 || json.Unmarshal(rec.Body.Bytes(), &result) != nil || len(result) != 4 ||
				result["storeId"] != "store-a" || result["version"] != float64(1) || result["operationId"] != "proposal-001" ||
				result["state"] != "REPLAYED" {
				t.Fatalf("unexpected receipt: %s", rec.Body.String())
			}
		})
	}
	readonly, err := newHandler("http://127.0.0.1:1", nil)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	readonly.ServeHTTP(rec, decisionRequest(proposalPath, proposalBody))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("isolated proposal exposed by read-only handler: %d", rec.Code)
	}
}
