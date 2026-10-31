package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRetiredDeliveryFeePolicyContract(t *testing.T) {
	const token = "finance-service-token"
	server := &Server{serviceToken: token}
	mux := http.NewServeMux()
	server.Register(mux)

	for _, test := range []struct {
		name, token string
		want        int
	}{
		{name: "unauthorized", want: http.StatusUnauthorized},
		{name: "authorized old write is disabled", token: token, want: http.StatusGone},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/wlt/v1/operator/delivery-fee-policies", strings.NewReader("{\"baseFeeMinor\":100}"))
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", recorder.Code, test.want, recorder.Body.String())
			}
			if recorder.Code == http.StatusGone && !strings.Contains(recorder.Body.String(), "LEGACY_PRICING_DISABLED") {
				t.Fatalf("legacy financial policy mutation must remain disabled: %s", recorder.Body.String())
			}
		})
	}
}
