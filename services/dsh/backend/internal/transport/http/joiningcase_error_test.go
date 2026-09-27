package transporthttp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestJoiningCaseErrorMapsUnavailableCommerceVertical(t *testing.T) {
	response := httptest.NewRecorder()
	writeJoiningCaseError(response, postgres.ErrCatalogVerticalNotFound)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != "VERTICAL_UNAVAILABLE" {
		t.Fatalf("error code = %q, want VERTICAL_UNAVAILABLE", body.Error.Code)
	}
}
