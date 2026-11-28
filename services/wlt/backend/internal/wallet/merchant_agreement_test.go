package wallet

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestMerchantAgreementStoreAuthority(t *testing.T) {
	for _, tc := range []struct {
		name, role, standing, second, relation string
		changeAfter                            int32
		change                                 string
		want, reads                            int
	}{
		{name: "owner", role: "merchant", standing: "DIRECT", second: "DIRECT", relation: "DIRECT", want: 200, reads: 1},
		{name: "foreign store", role: "merchant", relation: "DIRECT", want: 403},
		{name: "customer", role: "customer", standing: "DIRECT", second: "DIRECT", relation: "DIRECT", want: 403},
		{name: "revoked scope", role: "merchant", standing: "DIRECT", relation: "DIRECT", want: 403, reads: 1},
		{name: "changed relation", role: "merchant", standing: "DIRECT", second: "MARKETPLACE", relation: "DIRECT", want: 403, reads: 1},
		{name: "wrong proposal relation", role: "merchant", standing: "DIRECT", second: "DIRECT", relation: "MARKETPLACE", want: 503, reads: 1},
		{name: "wrong standing actor", role: "merchant", standing: "wrong-actor", second: "DIRECT", relation: "DIRECT", want: 503},
		{name: "revoked during initial standing", role: "merchant", standing: "DIRECT", second: "DIRECT", relation: "DIRECT", changeAfter: 1, change: "revoked", want: 401},
		{name: "revoked during final standing", role: "merchant", standing: "DIRECT", second: "DIRECT", relation: "DIRECT", changeAfter: 2, change: "revoked", want: 401, reads: 1},
		{name: "actor changed during final standing", role: "merchant", standing: "DIRECT", second: "DIRECT", relation: "DIRECT", changeAfter: 2, change: "actor", want: 401, reads: 1},
		{name: "role changed during final standing", role: "merchant", standing: "DIRECT", second: "DIRECT", relation: "DIRECT", changeAfter: 2, change: "role", want: 403, reads: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var checks atomic.Int32
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "no-store")
				if r.URL.Path == "/v1/sessions/current" {
					actor, role := "merchant-one", tc.role
					if tc.changeAfter > 0 && checks.Load() >= tc.changeAfter {
						switch tc.change {
						case "revoked":
							w.WriteHeader(http.StatusUnauthorized)
							return
						case "actor":
							actor = "merchant-two"
						case "role":
							role = "customer"
						}
					}
					_ = json.NewEncoder(w).Encode(principal{ActorID: actor, Role: role, Expires: time.Now().Add(time.Hour)})
					return
				}
				if r.URL.Path != "/v1/stores/mine" {
					t.Errorf("unexpected owner path %s", r.URL.Path)
					w.WriteHeader(404)
					return
				}
				rel := tc.standing
				if checks.Add(1) > 1 {
					rel = tc.second
				}
				actor := "merchant-one"
				if rel == "wrong-actor" {
					actor = "merchant-two"
					rel = "DIRECT"
				}
				if rel == "" {
					fmt.Fprintf(w, `{"actorId":%q,"stores":[]}`, actor)
					return
				}
				fmt.Fprintf(w, `{"actorId":%q,"stores":[{"id":"store-a","name":"Shop","relation":%q,"published":true}]}`, actor, rel)
			}))
			defer owner.Close()
			reads := 0
			handler, err := newHandlerWithHistoryMode(owner.URL, nil, nil, func(_ context.Context, store string) (agreementResult, error) {
				reads++
				return agreementResult{StoreID: store, Proposal: &agreementProposal{Relation: tc.relation}}, nil
			}, nil, false, owner.URL)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodGet, "/v1/merchants/stores/store-a/commercial-agreement", nil)
			req.Header.Set("Authorization", "Bearer "+"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.want || reads != tc.reads {
				t.Fatalf("status=%d reads=%d body=%s", rec.Code, reads, rec.Body.String())
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("owner read and denial must not be cached")
			}
			if tc.want != 200 {
				var body map[string]any
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body) != 1 || body["error"] == nil {
					t.Fatalf("denial must contain only the public error: %s", rec.Body.String())
				}
			}
			if tc.role != "merchant" && checks.Load() != 0 {
				t.Fatal("non-Merchant session reached DSH")
			}
		})
	}
}
