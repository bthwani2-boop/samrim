package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
)

func TestRetiredDeliveryFeePolicyContract(t *testing.T) {
	token := strings.Repeat("t", 32)
	authorizer, err := auth.NewServiceToken(token)
	if err != nil {
		t.Fatal(err)
	}
	server := &DeliveryFeeServer{auth: authorizer}
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
			request := httptest.NewRequest(http.MethodPost, "/dsh/operator/delivery-fee-policy", strings.NewReader("{\"baseFeeMinor\":100}"))
			if test.token != "" {
				request.Header.Set("Authorization", "Bearer "+test.token)
			}
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", recorder.Code, test.want, recorder.Body.String())
			}
			if recorder.Code == http.StatusGone && !strings.Contains(recorder.Body.String(), "LEGACY_PRICING_DISABLED") {
				t.Fatalf("legacy policy mutation must remain disabled: %s", recorder.Body.String())
			}
		})
	}
}
