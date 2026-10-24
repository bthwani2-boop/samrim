package transporthttp

import (
 "net/http"
 "net/http/httptest"
 "strings"
 "testing"

 "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/cart"
)

func TestCheckoutRejectsClosedStoreWithActionableCode(t *testing.T) {
 tests := []struct {name string; cause error; expected string}{
  {"closed", cart.ErrStoreNotAcceptingOrders, "STORE_NOT_ACCEPTING_ORDERS"},
  {"unsupported", cart.ErrFulfillmentModeUnavailable, "FULFILLMENT_MODE_UNAVAILABLE"},
 }
 for _,tt := range tests {
  t.Run(tt.name, func(t *testing.T) {
   recorder := httptest.NewRecorder()
   writeCartError(recorder, tt.cause)
   if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), `"code":"`+tt.expected+`"`) {
    t.Fatalf("status %d body %s, want 409 %s", recorder.Code, recorder.Body.String(), tt.expected)
   }
  })
 }
}
