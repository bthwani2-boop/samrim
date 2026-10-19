package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCartCheckoutRejectsMissingConfirmedQuoteBeforeService(t *testing.T) {
	for _, tc := range []struct{ name, field string }{
		{name: "missing accepted total"},
		{name: "zero accepted total", field: `,"expectedTotalAmountMinor":0`},
		{name: "negative accepted total", field: `,"expectedTotalAmountMinor":-1`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := `{"cartId":"cart-1","storeId":"store-1","fulfillmentMode":"CUSTOMER_PICKUP"` + tc.field + `}`
			req := httptest.NewRequest(http.MethodPost, "/dsh/cart/checkout", strings.NewReader(body))
			req.Header.Set("Authorization", "Bearer mock-client")
			req.Header.Set("X-Correlation-ID", "cart-confirmation-correlation")
			req.Header.Set("Idempotency-Key", "cart-confirmation-idempotency")
			req.Header.Set("X-Expected-Version", "2")
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			(&CartServer{}).checkout(response, req)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "INVALID_INPUT") {
				t.Fatalf("missing/invalid confirmation not rejected before side effects: status=%d response=%s", response.Code, response.Body.String())
			}
		})
	}
}
