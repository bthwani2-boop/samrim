package transporthttp

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestMarketingEventIdempotencyConflictReturnsHTTP409(t *testing.T) {
	for _, err := range []error{
		postgres.ErrDiscoveryContentEventConflict,
		errors.Join(errors.New("postgres event replay"), postgres.ErrDiscoveryContentEventConflict),
	} {
		recorder := httptest.NewRecorder()
		writeMarketingError(recorder, err)
		if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "IDEMPOTENCY_CONFLICT") {
			t.Fatalf("conflicting analytics event returned status=%d body=%q", recorder.Code, recorder.Body.String())
		}
	}
}
