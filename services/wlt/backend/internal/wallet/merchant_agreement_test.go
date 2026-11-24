package wallet

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMerchantAgreementStoreAuthority(t *testing.T) {
	for _, tc := range []struct {
		name, role, standing, second, relation string
		want, reads                            int
	}{
		{"owner", "merchant", "DIRECT", "DIRECT", "DIRECT", 200, 1},
		{"foreign store", "merchant", "", "", "DIRECT", 403, 0},
		{"customer", "customer", "DIRECT", "DIRECT", "DIRECT", 403, 0},
		{"revoked scope", "merchant", "DIRECT", "", "DIRECT", 403, 1},
		{"changed relation", "merchant", "DIRECT", "MARKETPLACE", "DIRECT", 403, 1},
		{"wrong proposal relation", "merchant", "DIRECT", "DIRECT", "MARKETPLACE", 503, 1},
		{"wrong actor", "merchant", "wrong-actor", "DIRECT", "DIRECT", 503, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			checks := 0
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "no-store")
				if r.URL.Path == "/v1/sessions/current" {
					_ = json.NewEncoder(w).Encode(principal{ActorID: "merchant-one", Role: tc.role, Expires: time.Now().Add(time.Hour)})
					return
				}
				if r.URL.Path != "/v1/stores/mine" {
					t.Errorf("unexpected owner path %s", r.URL.Path)
					w.WriteHeader(404)
					return
				}
				checks++
				rel := tc.standing
				if checks > 1 {
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
			if tc.want != 200 && rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("denial must not be cached")
			}
		})
	}
}
