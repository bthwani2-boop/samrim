package http

import (
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMissingSavedPartnerPayoutReturnsCanonicalAbsence(t *testing.T) {
	w := httptest.NewRecorder()
	writePartnerPayoutRequestError(w, postgres.ErrPayoutNotFound)
	if w.Code != 404 || !strings.Contains(w.Body.String(), "NOT_FOUND") {
		t.Fatalf("saved-intent absence must be distinguishable from an uncertain service failure: %d %s", w.Code, w.Body.String())
	}
}
