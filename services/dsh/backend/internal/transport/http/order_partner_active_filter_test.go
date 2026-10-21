package transporthttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOrderStateFilterAcceptsAllActivePartnerStates(t *testing.T) {
	active := "CREATED,PARTNER_ACCEPTED,PREPARING,READY_FOR_DISPATCH,READY_FOR_PICKUP,CAPTAIN_ASSIGNED,IN_CUSTODY"
	request := httptest.NewRequest(http.MethodGet, "/dsh/partner/orders?state="+active, nil)
	recorder := httptest.NewRecorder()
	value, ok := orderStateFilter(recorder, request)
	if !ok || value != active || recorder.Code != http.StatusOK {
		t.Fatalf("seven canonical active states must be accepted: ok=%v status=%d value=%q", ok, recorder.Code, value)
	}
}

func TestOrderStateFilterRejectsInvalidOrExcessiveStates(t *testing.T) {
	for _, states := range []string{
		"CREATED,NOT_REAL",
		strings.Repeat("CREATED,", 7) + "IN_CUSTODY",
	} {
		request := httptest.NewRequest(http.MethodGet, "/dsh/partner/orders?state="+states, nil)
		recorder := httptest.NewRecorder()
		if _, ok := orderStateFilter(recorder, request); ok || recorder.Code != http.StatusBadRequest {
			t.Errorf("filter should reject %q, status=%d", states, recorder.Code)
		}
	}
}
