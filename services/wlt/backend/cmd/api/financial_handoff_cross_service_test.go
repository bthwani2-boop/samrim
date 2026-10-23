package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	wltTarget, err := opsafety.RequireExpectedDatabaseTarget(wltURL, os.Getenv)
	if err != nil {
		t.Fatal(err)
	}
	dshTarget, err := url.Parse(dshURL)
	if err != nil || dshTarget.User == nil || dshTarget.Hostname() == "" || strings.Trim(dshTarget.Path, "/") == "" {
		t.Fatal("dedicated DSH test database must be an explicit PostgreSQL URL")
	}
	dshPort := dshTarget.Port()
	if dshPort == "" {
		dshPort = "5432"
	}
	// Distinct database names are required even when localhost aliases or proxies differ.
	if strings.Trim(dshTarget.Path, "/") == wltTarget.Name {
		t.Fatal("DSH and WLT financial proof must use separate test databases")
	}
	db, err := postgres.Open(wltURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
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
		StoreID: store, PartnerActorID: owner, Rates: []postgres.StoreCommercialAgreementRate{
			{FulfillmentMode: "CUSTOMER_PICKUP", CommissionRateBps: 1000},
			{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 1000},
		},
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
		ActorID: "proof-finance-approver", CurrentStorePartnerActorID: owner, CurrentFulfillmentModes: []string{"CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"},
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
	// WLT owns the simulator lifecycle. Delayed and unknown results cannot
	// create ledger money; a subsequent success must credit exactly once.
	for _, scenario := range []struct {
		name         string
		outcomes     []string
		finalState   string
		finalBalance int64
	}{
		{name: "failure", outcomes: []string{"FAILURE"}, finalState: "FAILED"},
		{name: "unknown", outcomes: []string{"UNKNOWN"}, finalState: "UNKNOWN"},
		{name: "delayed-then-success", outcomes: []string{"DELAYED", "UNKNOWN", "SUCCESS"}, finalState: "SETTLED", finalBalance: 501},
	} {
		actorID := "proof-sim-" + scenario.name
		extra, _, createErr := postgres.CreateCashInFundingIntent(ctx, db, postgres.CreateCashInFundingIntentInput{
			ActorType: "customer", ActorID: actorID, AmountMinor: 501, Currency: "YER",
			ProviderKey: postgres.DevelopmentSimulatorProvider, IdempotencyKey: "sim-create-" + scenario.name,
			CorrelationID: "sim-create-corr-" + scenario.name,
		})
		if createErr != nil {
			t.Fatalf("%s create intent: %v", scenario.name, createErr)
		}
		for _, outcome := range scenario.outcomes {
			input := postgres.ApplyCashInFundingResultInput{
				FundingIntentID: extra.ID, Outcome: outcome,
				ActorID: actorID, IdempotencyKey: "sim-result-" + scenario.name + "-" + outcome,
				CorrelationID: "sim-result-corr-" + scenario.name + "-" + outcome,
			}
			if outcome == "SUCCESS" {
				input.ProviderTransactionReference = "sim-txn-" + extra.ID
			}
			applied, replay, applyErr := postgres.ApplyCashInFundingResult(ctx, db, input)
			if applyErr != nil || replay {
				t.Fatalf("%s %s failed: replay=%t err=%v", scenario.name, outcome, replay, applyErr)
			}
			wantBalance := int64(0)
			if outcome == "SUCCESS" {
				wantBalance = 501
			}
			actual, readErr := postgres.ReadWalletBalance(ctx, db, "customer", actorID)
			if readErr != nil || actual != wantBalance {
				t.Fatalf("%s %s unexpected balance=%d expected=%d err=%v", scenario.name, outcome, actual, wantBalance, readErr)
			}
			if outcome == "SUCCESS" {
				again, duplicated, retryErr := postgres.ApplyCashInFundingResult(ctx, db, input)
				if retryErr != nil || !duplicated || again.ID != applied.ID ||
					again.LedgerTransactionID == nil || applied.LedgerTransactionID == nil ||
					*again.LedgerTransactionID != *applied.LedgerTransactionID {
					t.Fatalf("simulated success replay diverged: replay=%t err=%v applied=%v again=%v", duplicated, retryErr, applied.LedgerTransactionID, again.LedgerTransactionID)
				}
				after, balanceErr := postgres.ReadWalletBalance(ctx, db, "customer", actorID)
				if balanceErr != nil || after != 501 {
					t.Fatalf("replayed credit was not exactly once: balance=%d err=%v", after, balanceErr)
				}
			}
		}
		canonical, readErr := postgres.ReadCashInFundingIntent(ctx, db, extra.ID)
		if readErr != nil || canonical.State != scenario.finalState {
			t.Fatalf("%s state mismatch=%s err=%v", scenario.name, canonical.State, readErr)
		}
		final, balanceErr := postgres.ReadWalletBalance(ctx, db, "customer", actorID)
		if balanceErr != nil || final != scenario.finalBalance {
			t.Fatalf("%s final balance mismatch=%d err=%v", scenario.name, final, balanceErr)
		}
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
	// The same owned WLT instance must also settle an actual Captain delivery.
	// A funded Captain wallet is required to reserve the COD liability before
	// DSH assigns delivery custody. The customer is distinct from pickup.
	const courierOrder = "proof-courier-order"
	const courierCustomer = "proof-courier-customer"
	const courierCaptain = "proof-courier-captain"
	for _, account := range []struct {
		kind, actor string
		amount      int64
	}{
		{"customer", courierCustomer, 1200},
		{"captain", courierCaptain, 3000},
	} {
		funding, _, err := postgres.CreateCashInFundingIntent(ctx, db, postgres.CreateCashInFundingIntentInput{
			ActorType: account.kind, ActorID: account.actor, AmountMinor: account.amount,
			Currency: "YER", ProviderKey: postgres.DevelopmentSimulatorProvider,
			IdempotencyKey: account.actor + "-funding", CorrelationID: account.actor + "-funding-correlation",
		})
		if err != nil {
			t.Fatalf("prepare courier wallet for %s: %v", account.actor, err)
		}
		if _, _, err := postgres.ApplyCashInFundingResult(ctx, db, postgres.ApplyCashInFundingResultInput{
			FundingIntentID: funding.ID, Outcome: "SUCCESS",
			ProviderTransactionReference: account.actor + "-provider-receipt",
			ActorID:                      "proof-synthetic-provider", IdempotencyKey: account.actor + "-credit",
			CorrelationID: account.actor + "-credit-correlation",
		}); err != nil {
			t.Fatalf("fund courier account %s: %v", account.actor, err)
		}
	}
	courierPayment, _, err := postgres.CreatePaymentIntent(ctx, db, postgres.CreatePaymentIntentInput{
		ExternalReference: "proof-courier-payment", PayerActorID: courierCustomer, OrderID: courierOrder,
		AmountMinor: 300, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &postgres.CustomerPaymentAllocationInput{
			OrderID: courierOrder, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "proof-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 1500, InternalBalanceAmountMinor: 1200,
			CashAmountMinor: 300, CustomerPayableMinor: 1500, PolicyVersion: "proof-courier-v1",
		},
		IdempotencyKey: "proof-courier-payment-create", CorrelationID: "proof-courier-payment-correlation",
	})
	if err != nil {
		t.Fatalf("create real courier mixed funding: %v", err)
	}
	reserved, replayed, err := postgres.ReserveCaptainCOD(ctx, db, postgres.CaptainCODReservationInput{
		OrderID: courierOrder, PaymentIntentID: courierPayment.ID, CaptainActorID: courierCaptain,
		IdempotencyKey: "proof-courier-cod-reserve", CorrelationID: "proof-courier-cod-reserve-correlation",
	})
	if err != nil || replayed || reserved.State != "ACTIVE" {
		t.Fatalf("captain COD hold must exist before delivery: %+v replay=%t err=%v", reserved, replayed, err)
	}
	// A third independent actor exercises cancellation of mixed funding before
	// collection. A replay must release the wallet reservation only once.
	const cancelledOrder = "proof-cancel-order"
	const cancelledCustomer = "proof-cancel-customer"
	cancelFunding, _, err := postgres.CreateCashInFundingIntent(ctx, db, postgres.CreateCashInFundingIntentInput{
		ActorType: "customer", ActorID: cancelledCustomer, AmountMinor: 1200,
		Currency: "YER", ProviderKey: postgres.DevelopmentSimulatorProvider,
		IdempotencyKey: "proof-cancel-customer-funding", CorrelationID: "proof-cancel-customer-funding-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := postgres.ApplyCashInFundingResult(ctx, db, postgres.ApplyCashInFundingResultInput{
		FundingIntentID: cancelFunding.ID, Outcome: "SUCCESS",
		ProviderTransactionReference: "proof-cancel-provider-receipt",
		ActorID:                      "proof-synthetic-provider", IdempotencyKey: "proof-cancel-funding-success",
		CorrelationID: "proof-cancel-funding-correlation",
	}); err != nil {
		t.Fatal(err)
	}
	cancelPayment, _, err := postgres.CreatePaymentIntent(ctx, db, postgres.CreatePaymentIntentInput{
		ExternalReference: "proof-cancel-payment", PayerActorID: cancelledCustomer, OrderID: cancelledOrder,
		AmountMinor: 300, Currency: "YER", Method: domain.MethodCashAtStore,
		CustomerPaymentAllocation: &postgres.CustomerPaymentAllocationInput{
			OrderID: cancelledOrder, StoreID: store, PartnerActorID: owner,
			CommercialStoreTypeID: "proof-type", FulfillmentMode: "CUSTOMER_PICKUP",
			Currency: "YER", SubtotalMinor: 1500, InternalBalanceAmountMinor: 1200,
			CashAmountMinor: 300, CustomerPayableMinor: 1500, PolicyVersion: "proof-cancel-v1",
		},
		IdempotencyKey: "proof-cancel-payment-create", CorrelationID: "proof-cancel-payment-correlation",
	})
	if err != nil {
		t.Fatalf("create cancellation-ready mixed payment: %v", err)
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
		"BTHWANI_EXPECTED_DATABASE_HOST="+strings.ToLower(dshTarget.Hostname()),
		"BTHWANI_EXPECTED_DATABASE_PORT="+dshPort,
		"BTHWANI_EXPECTED_DATABASE_USER="+dshTarget.User.Username(),
		"BTHWANI_EXPECTED_DATABASE_NAME="+strings.Trim(dshTarget.Path, "/"),
		"WLT_FINANCIAL_HANDOFF_REAL_URL="+liveWLT.URL,
		"WLT_FINANCIAL_PROOF_SERVICE_TOKEN="+token,
		"WLT_FINANCIAL_PROOF_PAYMENT_ID="+payment.ID,
		"WLT_FINANCIAL_PROOF_ORDER_ID="+order,
		"WLT_FINANCIAL_PROOF_PARTNER_ID="+owner,
		"WLT_FINANCIAL_PROOF_COURIER_ORDER_ID="+courierOrder,
		"WLT_FINANCIAL_PROOF_COURIER_PAYMENT_ID="+courierPayment.ID,
		"WLT_FINANCIAL_PROOF_COURIER_CAPTAIN_ID="+courierCaptain,
		"WLT_FINANCIAL_PROOF_CANCEL_ORDER_ID="+cancelledOrder,
		"WLT_FINANCIAL_PROOF_CANCEL_PAYMENT_ID="+cancelPayment.ID,
		"WLT_FINANCIAL_PROOF_CANCEL_CLIENT_ID="+cancelledCustomer,
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
	courierFinal, err := postgres.ReadPaymentIntent(ctx, db, courierPayment.ID)
	if err != nil || courierFinal.State != "COLLECTED" {
		t.Fatalf("courier COD/WLT collection was not persisted: %+v err=%v", courierFinal, err)
	}
	verifyCollectedCourierReviewedCompensation(t, ctx, db, courierOrder, courierPayment.ID, courierCustomer)
	var debitedCOD, courierEarnings, financialOutliers int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE order_id=$1 AND captain_actor_id=$2 AND state='DEBITED'",
		courierOrder, courierCaptain).Scan(&debitedCOD); err != nil || debitedCOD != 1 {
		t.Fatalf("courier COD wallet debit state count=%d err=%v", debitedCOD, err)
	}
	// Delivery is complete only if WLT debited exactly the cash held (not
	// the full mixed customer payment) and cleared the same receivable once.
	var debitPostings int
	var debitAmount, clearedReceivable int64
	err = db.QueryRowContext(ctx, `SELECT
		COUNT(DISTINCT e.transaction_id),
		COALESCE(SUM(e.amount_minor) FILTER (WHERE e.account_code='CAPTAIN_WALLET'
			AND e.direction='DEBIT' AND e.actor_type='captain' AND e.actor_id=$2),0),
		COALESCE(SUM(e.amount_minor) FILTER (WHERE e.account_code='CAPTAIN_CASH_RECEIVABLE'
			AND e.direction='CREDIT'),0)
		FROM wlt.ledger_transactions t
		JOIN wlt.ledger_entries e ON e.transaction_id=t.id
		JOIN wlt.captain_cod_reservations r ON r.id=t.source_id
		WHERE t.source_type='CAPTAIN_COD_WALLET_DEBIT' AND r.order_id=$1
			AND r.captain_actor_id=$2`, courierOrder, courierCaptain).
		Scan(&debitPostings, &debitAmount, &clearedReceivable)
	if err != nil || debitPostings != 1 || debitAmount != 300 || clearedReceivable != 300 {
		t.Fatalf("COD debit must be once and exact: postings=%d debit=%d clearing=%d err=%v",
			debitPostings, debitAmount, clearedReceivable, err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wlt.partner_order_earnings WHERE order_id=$1",
		courierOrder).Scan(&courierEarnings); err != nil || courierEarnings != 1 {
		t.Fatalf("courier partner earnings count=%d err=%v", courierEarnings, err)
	}
	cancelled, err := postgres.ReadPaymentIntent(ctx, db, cancelPayment.ID)
	if err != nil || cancelled.State != "CANCELLED" {
		t.Fatalf("cancellation not persisted in WLT: %+v err=%v", cancelled, err)
	}
	restored, err := postgres.ReadWalletBalance(ctx, db, "customer", cancelledCustomer)
	if err != nil || restored != 1200 {
		t.Fatalf("cancelled mixed payment must return reserved 1200 once: %d err=%v", restored, err)
	}
	var cancelEarnings int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM wlt.partner_order_earnings WHERE order_id=$1", cancelledOrder).Scan(&cancelEarnings); err != nil || cancelEarnings != 0 {
		t.Fatalf("cancelled order earned unexpected partner money: %d err=%v", cancelEarnings, err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM (
		SELECT transaction_id FROM wlt.ledger_entries GROUP BY transaction_id
		HAVING SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE -amount_minor END)<>0
	) unbalanced`).Scan(&financialOutliers); err != nil || financialOutliers != 0 {
		t.Fatalf("WLT unbalanced ledger groups=%d err=%v", financialOutliers, err)
	}
}
