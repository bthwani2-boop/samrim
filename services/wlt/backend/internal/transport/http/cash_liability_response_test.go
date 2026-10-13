package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func TestCashLiabilityResponsePreservesUncappedOutstandingSummary(t *testing.T) {
	writer := httptest.NewRecorder()
	writeCashLiability(writer, postgres.CashLiabilityList{
		Items:            []postgres.CashLiability{{PaymentIntentID: "intent-1", AmountMinor: 100, Currency: "YER"}},
		TotalAmountMinor: 11100,
		TotalItems:       101,
		HasMore:          true,
	})
	if writer.Code != http.StatusOK {
		t.Fatalf("cash liability status=%d", writer.Code)
	}
	var response cashLiabilityResponse
	if err := json.Unmarshal(writer.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode cash liability: %v", err)
	}
	if len(response.Items) != 1 || response.Items[0].AmountMinor != 100 ||
		response.TotalAmountMinor != 11100 || response.TotalItems != 101 || !response.HasMore {
		t.Fatalf("cash liability summary lost outstanding items: %+v", response)
	}
}
