package order

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

// Invoked only by the WLT-owned isolated PostgreSQL integration harness.
// Identity is a scoped test adapter; DSH invokes the real WLT HTTP server.
func TestRealWLTLegacyCODRecoveryViaDSHOperator(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_LEGACY_COD_REAL_WLT_URL"))
	if url == "" {
		t.Skip("isolated WLT HTTP server is not configured")
	}
	if os.Getenv("BTHWANI_ENV") != "test" || os.Getenv("BTHWANI_FINANCIAL_PROOF_ISOLATED") != "1" {
		t.Fatal("refuse non-isolated legacy COD cross-service proof")
	}
	token, paymentID, evidenceID := os.Getenv("DSH_LEGACY_COD_SERVICE_TOKEN"), os.Getenv("DSH_LEGACY_COD_PAYMENT_ID"), os.Getenv("DSH_LEGACY_COD_EVIDENCE_ID")
	if len(token) < 24 || paymentID == "" || evidenceID == "" {
		t.Fatal("isolated WLT legacy COD fixture is incomplete")
	}
	const submitter = "legacy-finance-submitter"
	const approver = "legacy-finance-approver"
	identityServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet {
			http.Error(w, "unexpected Identity method", http.StatusMethodNotAllowed)
			return
		}
		for _, actor := range []string{submitter, approver} {
			switch r.URL.Path {
			case "/internal/actors/" + actor + "/roles/operator":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"actorId": actor, "role": "operator", "enabled": true,
					"securityEnabled": true, "activatedAt": "2026-11-01T00:00:00Z",
				})
				return
			case "/internal/operators/" + actor + "/permissions/finance":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"actorId": actor, "permission": "finance", "enabled": true,
				})
				return
			}
		}
		http.Error(w, "unknown Identity actor or permission", http.StatusForbidden)
	}))
	defer identityServer.Close()
	endpoint, err := identityintegration.ResolveBaseURL(identityServer.URL, "test")
	if err != nil {
		t.Fatal(err)
	}
	identity, err := identityintegration.New(endpoint, strings.Repeat("i", 24))
	if err != nil {
		t.Fatal(err)
	}
	payment, err := wltintegration.New(url, "test", token)
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{identity: identity, payment: payment}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	submit, err := service.SubmitLegacyCODRecovery(ctx, submitter, paymentID, evidenceID,
		"legacy-dsh-submit", "legacy-dsh-submit-correlation")
	if err != nil || submit.IdempotentReplay || submit.Review.Status != "PENDING" || submit.Review.PaymentIntentID != paymentID {
		t.Fatalf("real WLT submission through DSH: %+v err=%v", submit, err)
	}
	replayed, err := service.SubmitLegacyCODRecovery(ctx, submitter, paymentID, evidenceID,
		"legacy-dsh-submit", "legacy-dsh-submit-correlation")
	if err != nil || !replayed.IdempotentReplay || replayed.Review.ID != submit.Review.ID {
		t.Fatalf("real WLT review replay through DSH: %+v err=%v", replayed, err)
	}
	read, err := service.ReadLegacyCODRecoveryByPayment(ctx, approver, paymentID)
	if err != nil || read.Review.ID != submit.Review.ID || read.Review.Status != "PENDING" {
		t.Fatalf("independent Finance readback: %+v err=%v", read, err)
	}
	_, err = service.ApproveLegacyCODRecovery(ctx, submitter, submit.Review.ID,
		"legacy-dsh-self-approve", "legacy-dsh-self-approve-correlation")
	var denied *wltintegration.Error
	if !errors.As(err, &denied) || denied.Status != http.StatusForbidden {
		t.Fatalf("submitter approved their own real WLT review: %v", err)
	}
	approved, err := service.ApproveLegacyCODRecovery(ctx, approver, submit.Review.ID,
		"legacy-dsh-independent-approval", "legacy-dsh-approval-correlation")
	if err != nil || approved.IdempotentReplay || approved.Review.Status != "APPROVED" ||
		approved.Review.ApprovedBy != approver || approved.Review.ReservationID == "" {
		t.Fatalf("real WLT reviewed approval through DSH: %+v err=%v", approved, err)
	}
	again, err := service.ApproveLegacyCODRecovery(ctx, approver, submit.Review.ID,
		"legacy-dsh-independent-approval", "legacy-dsh-approval-correlation")
	if err != nil || !again.IdempotentReplay || again.Review.ReservationID != approved.Review.ReservationID {
		t.Fatalf("real WLT approved replay through DSH: %+v err=%v", again, err)
	}
	t.Logf("real DSH Finance authorization -> WLT review APPROVED with persisted reservation=%s", approved.Review.ReservationID)
}
