package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestJoiningCaseAdmissionClosureUsesConflictResponse(t *testing.T) {
	response := httptest.NewRecorder()
	writeJoiningCaseError(response, postgres.ErrStoreJoiningClosed)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"STORE_JOINING_CLOSED"`) {
		t.Fatalf("paused Store admission must return a recoverable conflict: HTTP %d %s", response.Code, response.Body.String())
	}
}

func TestFirstStoreCreateRejectsActorOverrideAndMissingIdempotency(t *testing.T) {
	for _, tc := range []struct {
		name   string
		header string
		value  string
	}{
		{name: "missing idempotency key"},
		{name: "short idempotency key", header: "Idempotency-Key", value: "short"},
		{name: "spoof actor id", header: "X-Actor-ID", value: "other-partner"},
		{name: "spoof acting actor id", header: "X-Acting-Actor-ID", value: "other-partner"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/dsh/partner/stores/first", strings.NewReader("{}"))
			r.Header.Set("Authorization", "Bearer session-token")
			if tc.header != "" {
				r.Header.Set(tc.header, tc.value)
			}
			if tc.header != "Idempotency-Key" && tc.header != "" {
				r.Header.Set("Idempotency-Key", "bounded-idempotency-key-0001")
			}
			w := httptest.NewRecorder()
			(&JoiningCaseServer{}).createPartnerFirstStore(w, r)
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "INVALID_INPUT") {
				t.Fatalf("invalid first Store headers were admitted: HTTP %d %s", w.Code, w.Body.String())
			}
		})
	}
}
