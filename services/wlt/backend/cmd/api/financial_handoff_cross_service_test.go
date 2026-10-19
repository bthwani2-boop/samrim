package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/wlt/backend/internal/transport/http"
)

func TestIsolatedDSHToRealWLTStorePickupMixedPayment(t *testing.T) {
	wltURL := strings.TrimSpace(os.Getenv("WLT_TEST_DATABASE_URL"))
	dshURL := strings.TrimSpace(os.Getenv("DSH_FINANCIAL_HANDOFF_TEST_DATABASE_URL"))
	if wltURL == "" || dshURL == "" {
		t.Skip("two separate owned test PostgreSQL databases required")
	}
	if os.Getenv("BTHWANI_ENV") != "test" || os.Getenv("BTHWANI_FINANCIAL_PROOF_ISOLATED") != "1" {
		t.Fatal("refuse non-isolated cross-service financial proof")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(wltURL, os.Getenv); err != nil {
		t.Fatal(err)
	}
	db, err := postgres.Open(wltURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 70*time.Second)
	defer cancel()
	var fresh bool
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('wlt.schema_migrations') IS NULL").Scan(&fresh); err != nil || !fresh {
		t.Fatalf("refuse non-pristine WLT database: fresh=%t err=%v", fresh, err)
	}
	records, statements, err := postgres.LoadMigrations(filepath.Join("..", "..", "..", "database", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if err := postgres.Migrate(ctx, db, records, statements); err != nil {
		t.Fatal(err)
	}
	if err := postgres.VerifySchema(ctx, db, records); err != nil {
		t.Fatal(err)
	}
	owner, customer := "proof-pickup-owner", "proof-pickup-customer"
	store, order := "proof-pickup-store", "proof-pickup-order"
	profile, _, err := postgres.PreparePartnerFinancialProfile(ctx, db, postgres.PreparePartnerFinancialProfileInput{
		JoiningCaseID: "proof-pickup-case", PartnerActorID: owner, Origin: domain.OriginControlPanel,
		SettlementPeriod: domain.SettlementWeekly, IdempotencyKey: "proof-profile-key", CorrelationID: "proof-profile-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = postgres.ActivatePartnerFinancialProfile(ctx, db, postgres.ActivatePartnerFinancialProfileInput{
		ProfileID: profile.ID, ExpectedVersion: profile.Version, ActorID: "proof-finance-operator",
		IdempotencyKey: "proof-profile-activate", CorrelationID: "proof-activate-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	agreement, _, err := postgres.ProposeStoreCommercialAgreement(ctx, db, postgres.ProposeStoreCommercialAgreementInput{
		StoreID: store, PartnerActorID: owner, Rates: []postgres.StoreCommercialAgreementRate{{FulfillmentMode: "CUSTOMER_PICKUP", CommissionRateBps: 1000}},
		ActorID: "proof-proposer", Reason: "owned isolated DSH-WLT proof", IdempotencyKey: "proof-store-propose", CorrelationID: "proof-propose-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	agreement, _, err = postgres.AcceptStoreCommercialAgreement(ctx, db, agreement.AgreementID, agreement.AgreementVersion, owner,
		"owned Store accepted", "proof-store-accept", "proof-accept-correlation")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = postgres.DecideStoreCommercialAgreement(ctx, db, postgres.StoreCommercialAgreementDecisionInput{
		AgreementID: agreement.AgreementID, ExpectedVersion: agreement.AgreementVersion, Decision: "APPROVE",
		ActorID: "proof-finance-approver", CurrentStorePartnerActorID: owner, CurrentFulfillmentModes: []string{"CUSTOMER_PICKUP"},
		Reason: "owned Store approval", IdempotencyKey: "proof-store-approve", CorrelationID: "proof-approve-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	funding, _, err := postgres.CreateCashInFundingIntent(ctx, db, postgres.CreateCashInFundingIntentInput{
		ActorType: "customer", ActorID: customer, AmountMinor: 1200, Currency: "YER", ProviderKey: postgres.DevelopmentSimulatorProvider,
		IdempotencyKey: "proof-wallet-funding", CorrelationID: "proof-wallet-funding-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = postgres.ApplyCashInFundingResult(ctx, db, postgres.ApplyCashInFundingResultInput{
		FundingIntentID: funding.ID, Outcome: "SUCCESS", ProviderTransactionReference: "proof-simulated-receipt",
		ActorID: "proof-synthetic-provider", IdempotencyKey: "proof-wallet-credit", CorrelationID: "proof-wallet-credit-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	balance, err := postgres.ReadWalletBalance(ctx, db, "customer", customer)
	if err != nil || balance != 1200 {
		t.Fatalf("initial wallet funded by canonical simulator: balance=%d err=%v", balance, err)
	}
	payment, _, err := postgres.CreatePaymentIntent(ctx, db, postgres.CreatePaymentIntentInput{
		ExternalReference: "proof-pickup-payment", PayerActorID: customer, OrderID: order,
		AmountMinor: 300, Currency: "YER", Method: domain.MethodCashAtStore,
		CustomerPaymentAllocation: &postgres.CustomerPaymentAllocationInput{
			OrderID: order, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "proof-type", FulfillmentMode: "CUSTOMER_PICKUP",
			Currency: "YER", SubtotalMinor: 1500, InternalBalanceAmountMinor: 1200,
			CashAmountMinor: 300, CustomerPayableMinor: 1500, PolicyVersion: "proof-v1",
		},
		IdempotencyKey: "proof-pickup-create", CorrelationID: "proof-pickup-create-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	const token = "only-test-owned-wlt-token"
	const cipher = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
	server, err := transporthttp.New(db, token, cipher, cipher)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	server.Register(mux)
	liveWLT := httptest.NewServer(mux)
	defer liveWLT.Close()
	dshDir, err := filepath.Abs(filepath.Join("..", "..", "..", "..", "..", "services", "dsh", "backend"))
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "go", "test", "-C", dshDir, "./internal/financialhandoff",
		"-run", "^TestRealWLTStorePickupMixedFundingReconcilesAcrossDatabases$", "-count=1", "-v")
	// The child has a different explicit expected database name; never hand it
	// WLT's expected target to mutate by accident.
	env := make([]string, 0, len(os.Environ())+14)
	for _, line := range os.Environ() {
		if strings.HasPrefix(line, "BTHWANI_EXPECTED_DATABASE_") ||
			strings.HasPrefix(line, "WLT_FINANCIAL_PROOF_") {
			continue
		}
		env = append(env, line)
	}
	cmd.Env = append(env,
		"BTHWANI_EXPECTED_DATABASE_HOST=127.0.0.1",
		"BTHWANI_EXPECTED_DATABASE_PORT="+os.Getenv("BTHWANI_EXPECTED_DATABASE_PORT"),
		"BTHWANI_EXPECTED_DATABASE_USER=postgres",
		"BTHWANI_EXPECTED_DATABASE_NAME=dsh_a04_realfunding",
		"WLT_FINANCIAL_HANDOFF_REAL_URL="+liveWLT.URL,
		"WLT_FINANCIAL_PROOF_SERVICE_TOKEN="+token,
		"WLT_FINANCIAL_PROOF_PAYMENT_ID="+payment.ID,
		"WLT_FINANCIAL_PROOF_ORDER_ID="+order,
		"WLT_FINANCIAL_PROOF_PARTNER_ID="+owner,
	)
	output, err := cmd.CombinedOutput()
	t.Log(string(output))
	if err != nil {
		t.Fatalf("real DSH financialhandoff -> real WLT server failed: %v", err)
	}
	finalPayment, err := postgres.ReadPaymentIntent(ctx, db, payment.ID)
	if err != nil || finalPayment.State != "COLLECTED" {
		t.Fatalf("WLT persisted collected order=%+v err=%v", finalPayment, err)
	}
	commission, err := postgres.ReadPartnerStoreCashCommission(ctx, db, order)
	if err != nil || commission.CommissionMinor != 150 || commission.FulfillmentMode != "CUSTOMER_PICKUP" {
		t.Fatalf("WLT persisted partner commission receivable=%+v err=%v", commission, err)
	}
	balance, err = postgres.ReadWalletBalance(ctx, db, "customer", customer)
	if err != nil || balance != 0 {
		t.Fatalf("wallet should fund exactly 1200 once, balance=%d err=%v", balance, err)
	}
	var count int
	var debits, credits int64
	err = db.QueryRowContext(ctx, `SELECT COUNT(*),
		COALESCE(SUM(amount_minor) FILTER(WHERE direction='DEBIT'),0),
		COALESCE(SUM(amount_minor) FILTER(WHERE direction='CREDIT'),0)
		FROM wlt.ledger_entries WHERE transaction_id=$1`, commission.LedgerTransactionID).Scan(&count, &debits, &credits)
	if err != nil || count < 2 || debits != credits {
		t.Fatalf("WLT ledger final readback: lines=%d debit=%d credit=%d err=%v", count, debits, credits, err)
	}
	var exact int
	err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wlt.partner_store_cash_commissions WHERE order_id=$1", order).Scan(&exact)
	if err != nil || exact != 1 {
		t.Fatalf("double earning under retries: count=%d err=%v", exact, err)
	}
}
