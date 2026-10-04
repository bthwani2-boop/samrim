package wlt

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadStoreTypeCommissionDefaultsContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/wlt/v1/operator/commercial-store-type-commission-defaults" || r.URL.Query().Get("commercialStoreTypeId") != "type & one" {
			t.Errorf("commission defaults read request = %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("commission defaults read auth = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"commercialStoreTypeId":"type & one","defaults":[{"commercialStoreTypeId":"type & one","fulfillmentMode":"PARTNER_CAPTAIN","suggestedCommissionRateBps":1250,"defaultVersion":3,"changedByActorId":"operator-1","changeReason":"terms review"}]}`))
	}))
	defer server.Close()

	client, err := New(server.URL, "development", "test-token")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.ReadStoreTypeCommissionDefaults(context.Background(), " type & one ")
	if err != nil || result.CommercialStoreTypeID != "type & one" || len(result.Defaults) != 1 || result.Defaults[0].SuggestedCommissionRateBps != 1250 || result.Defaults[0].DefaultVersion != 3 {
		t.Fatalf("commission defaults read result = %+v, error=%v", result, err)
	}
}
