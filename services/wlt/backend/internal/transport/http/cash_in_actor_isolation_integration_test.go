package http

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

// This proof requires the explicitly isolated, disposable WLT_TEST_DATABASE_URL.
// A valid service token must not let the manual development simulator settle
// a different Customer or Captain's funding intent.
func TestIsolatedManualSimulatorRejectsForeignActorBeforePostingLedger(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WLT_TEST_DATABASE_URL is not configured")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatal(err)
	}
	db, err := postgres.Open(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	migrations, statements, err := postgres.LoadMigrations(filepath.Join("..", "..", "..", "..", "database", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if err := postgres.Migrate(ctx, db, migrations, statements); err != nil {
		t.Fatal(err)
	}
	if err := postgres.VerifySchema(ctx, db, migrations); err != nil {
		t.Fatal(err)
	}

	const token = "isolated-wlt-cash-in-route-token"
	const cipher = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
	s, err := NewWithCashInConfig(db, token, cipher, cipher, "simulator", "development")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.Register(mux)

	for _, role := range []string{"customer", "captain"} {
		t.Run(role, func(t *testing.T) {
			owner := role + "-cash-in-owner"
			foreign := role + "-cash-in-foreign"
			input := postgres.CreateCashInFundingIntentInput{
				ActorType: role, ActorID: owner, AmountMinor: 1000,
				Currency: "YER", ProviderKey: postgres.DevelopmentSimulatorProvider,
				IdempotencyKey: role + "-cash-in-isolation-create",
				CorrelationID:  role + "-cash-in-isolation-created",
			}
			intent, replay, err := postgres.CreateCashInFundingIntent(ctx, db, input)
			if err != nil || replay || intent.State != "PENDING_PROVIDER" {
				t.Fatalf("create isolated funding intent: %+v replay=%t err=%v", intent, replay, err)
			}
			post := func(fundingID, actor, suffix string) *httptest.ResponseRecorder {
				t.Helper()
				path := fmt.Sprintf("/wlt/v1/development/funding-intents/%s/simulate", fundingID)
				req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"outcome":"SUCCESS"}`))
				req.Header.Set("Authorization", "Bearer "+token)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Acting-Actor-ID", actor)
				req.Header.Set("X-Correlation-ID", role+"-cashin-"+suffix+"-correlation")
				req.Header.Set("Idempotency-Key", role+"-cashin-"+suffix+"-idempotency")
				res := httptest.NewRecorder()
				mux.ServeHTTP(res, req)
				return res
			}
			foreignAttempt := post(intent.ID, foreign, "foreign")
			if foreignAttempt.Code != http.StatusNotFound {
				t.Fatalf("foreign actor settled or disclosed funding: status=%d body=%s", foreignAttempt.Code, foreignAttempt.Body.String())
			}
			before, err := postgres.ReadCashInFundingIntent(ctx, db, intent.ID)
			if err != nil || before.State != "PENDING_PROVIDER" || before.LedgerTransactionID != nil {
				t.Fatalf("foreign actor changed owner funding: %+v err=%v", before, err)
			}
			balance, err := postgres.ReadWalletBalance(ctx, db, role, owner)
			if err != nil || balance != 0 {
				t.Fatalf("foreign actor credited owner wallet: balance=%d err=%v", balance, err)
			}
			ownAttempt := post(intent.ID, owner, "owner")
			if ownAttempt.Code != http.StatusOK {
				t.Fatalf("legitimate owner cannot settle development intent: status=%d body=%s", ownAttempt.Code, ownAttempt.Body.String())
			}
			settled, err := postgres.ReadCashInFundingIntent(ctx, db, intent.ID)
			if err != nil || settled.State != "SETTLED" || settled.LedgerTransactionID == nil {
				t.Fatalf("owner settlement not persisted in WLT: %+v err=%v", settled, err)
			}
			balance, err = postgres.ReadWalletBalance(ctx, db, role, owner)
			if err != nil || balance != 1000 {
				t.Fatalf("owner wallet amount not credited exactly once: balance=%d err=%v", balance, err)
			}
			if lateForeign := post(intent.ID, foreign, "after-settlement"); lateForeign.Code != http.StatusNotFound {
				t.Fatalf("foreign replay disclosed settled state: status=%d body=%s", lateForeign.Code, lateForeign.Body.String())
			}
			// Switching from the HTTP provider mock to the manual simulator must
			// never let a mock-provider intent be settled by a fabricated outcome.
			mockInput := input
			mockInput.ProviderKey = "WALLET_PROVIDER_TEST_ALPHA"
			mockInput.IdempotencyKey = role + "-cash-in-cross-mode-create"
			mockInput.CorrelationID = role + "-cash-in-cross-mode-created"
			mockIntent, replay, err := postgres.CreateCashInFundingIntent(ctx, db, mockInput)
			if err != nil || replay {
				t.Fatalf("create pending mock-provider intent: replay=%t err=%v", replay, err)
			}
			mockAttempt := post(mockIntent.ID, owner, "cross-mode")
			if mockAttempt.Code != http.StatusForbidden {
				t.Fatalf("manual simulator settled a provider-mock funding intent: status=%d body=%s", mockAttempt.Code, mockAttempt.Body.String())
			}
			mockStored, err := postgres.ReadCashInFundingIntent(ctx, db, mockIntent.ID)
			if err != nil || mockStored.State != "PENDING_PROVIDER" || mockStored.LedgerTransactionID != nil {
				t.Fatalf("cross-mode simulator wrote an unverified funding result: %+v err=%v", mockStored, err)
			}
			foreignBalance, err := postgres.ReadWalletBalance(ctx, db, role, foreign)
			if err != nil || foreignBalance != 0 {
				t.Fatalf("foreign actor gained wallet credit: balance=%d err=%v", foreignBalance, err)
			}
			var debit, credit int64
			err = db.QueryRowContext(ctx, `SELECT
				COALESCE(SUM(amount_minor) FILTER (WHERE direction='DEBIT'),0),
				COALESCE(SUM(amount_minor) FILTER (WHERE direction='CREDIT'),0)
				FROM wlt.ledger_entries WHERE transaction_id=$1`, *settled.LedgerTransactionID).Scan(&debit, &credit)
			if err != nil || debit != 1000 || credit != 1000 {
				t.Fatalf("owner credit transaction unbalanced: debit=%d credit=%d err=%v", debit, credit, err)
			}
		})
	}
}
