package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCaptainCashRemittanceIsRetired(t *testing.T) {
	server := &CaptainServer{}
	for _, test := range []struct {
		name, authorization string
		want                int
	}{
		{"authenticated captain cannot remit cash to BThwani", "Bearer captain-test-token", http.StatusGone},
		{"no session", "", http.StatusUnauthorized},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/dsh/captains/me/cash-liability/historical/remit", nil)
			if test.authorization != "" {
				r.Header.Set("Authorization", test.authorization)
			}
			recorder := httptest.NewRecorder()
			server.remitCash(recorder, r)
			if recorder.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", recorder.Code, test.want, recorder.Body.String())
			}
			if recorder.Code == http.StatusGone && !strings.Contains(recorder.Body.String(), "CAPTAIN_CASH_REMITTANCE_DISABLED") {
				t.Fatalf("expected explicit retired financial route: %s", recorder.Body.String())
			}
		})
	}
}
