package transporthttp

import (
	nethttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/captain"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestCaptainCODPreflightErrorStatus(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"insufficient captain wallet balance is a business conflict", captain.ErrCaptainWalletInsufficientFunds, nethttp.StatusConflict, "INSUFFICIENT_FUNDS"},
		{"competing COD reservation is a state conflict", postgres.ErrCaptainAssignmentConflict, nethttp.StatusConflict, "VERSION_OR_STATE_CONFLICT"},
		{"missing COD allocation is a payment conflict", postgres.ErrPaymentStateConflict, nethttp.StatusConflict, "PAYMENT_STATE_CONFLICT"},
		{"genuine WLT outage remains a gateway failure", captain.ErrPaymentUnavailable, nethttp.StatusBadGateway, "WLT_PAYMENT_UNAVAILABLE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeCaptainError(response, tc.err)
			if response.Code != tc.status || !strings.Contains(response.Body.String(), "\""+tc.code+"\"") {
				t.Fatalf("got status=%d response=%s; want status=%d code=%s", response.Code, response.Body.String(), tc.status, tc.code)
			}
		})
	}
}
