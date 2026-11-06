package main

import (
	"context"
	"database/sql"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

// This runs inside the existing isolated cross-service test, reusing its
// disposable database, approved Store and real WLT HTTP handler. No live
// Identity, production funds or durable local data participate.
type historicalCODReviewProof struct {
	orderID   string
	paymentID string
	captainID string
	cashMinor int64
}

func verifyLegacyCODRecoveryThroughDSH(t *testing.T, ctx context.Context, db *sql.DB, wltURL, serviceToken, partnerID, storeID, dshDir string) historicalCODReviewProof {
	t.Helper()
	const orderID = "proof-legacy-cod-order"
	const captainID = "proof-legacy-cod-captain"
	const cash = int64(5500)
	payment, replay, err := postgres.CreatePaymentIntent(ctx, db, postgres.CreatePaymentIntentInput{
		ExternalReference: "proof-legacy-cod-payment", PayerActorID: "proof-legacy-cod-customer",
		OrderID: orderID, AmountMinor: cash, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &postgres.CustomerPaymentAllocationInput{
			OrderID: orderID, StoreID: storeID, PartnerActorID: partnerID,
			CommercialStoreTypeID: "proof-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 5000, DeliveryFeeMinor: 500,
			CashAmountMinor: cash, CustomerPayableMinor: cash, PolicyVersion: "proof-legacy-policy",
		},
		IdempotencyKey: "proof-legacy-payment-create", CorrelationID: "proof-legacy-payment-correlation",
	})
	if err != nil || replay {
		t.Fatalf("prepare historical COD payment: replay=%v err=%v", replay, err)
	}
	// Only this isolated synthetic record models old pre-hold collection.
	result, err := db.ExecContext(ctx,
		"UPDATE wlt.payment_intents SET state='COLLECTED',version=version+1,"+
			"collected_amount_minor=$2,collected_by_actor_id=$3,collection_reference='proof-legacy-original-receipt',"+
			"collected_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND state='REQUIRES_COLLECTION'",
		payment.ID, cash, captainID)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		t.Fatalf("historical collected row count=%d err=%v", n, err)
	}
	funding, replay, err := postgres.CreateCashInFundingIntent(ctx, db, postgres.CreateCashInFundingIntentInput{
		ActorType: "captain", ActorID: captainID, AmountMinor: 20000, Currency: "YER",
		ProviderKey:    postgres.DevelopmentSimulatorProvider,
		IdempotencyKey: "proof-legacy-funding", CorrelationID: "proof-legacy-funding-correlation",
	})
	if err != nil || replay {
		t.Fatalf("prepare original Captain wallet: replay=%v err=%v", replay, err)
	}
	if _, replay, err := postgres.ApplyCashInFundingResult(ctx, db, postgres.ApplyCashInFundingResultInput{
		FundingIntentID: funding.ID, Outcome: "SUCCESS", ActorID: "proof-synthetic-provider",
		ProviderTransactionReference: "proof-legacy-wallet-funding-result",
		IdempotencyKey:               "proof-legacy-funding-settle", CorrelationID: "proof-legacy-funding-settle-correlation",
	}); err != nil || replay {
		t.Fatalf("settle Captain cover using WLT simulator: replay=%v err=%v", replay, err)
	}
	cipher, err := postgres.NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := postgres.SaveFinanceEvidenceDocument(ctx, db, cipher, postgres.FinanceEvidenceDocumentInput{
		Purpose: "CAPTAIN_COD_LEGACY_RECOVERY", Filename: "historical-cod.pdf",
		ContentType: "application/pdf", Content: []byte("%PDF-1.4\nisolated original collection evidence\n%%EOF"),
		ActorID: "legacy-finance-submitter", IdempotencyKey: "proof-legacy-review-document",
		CorrelationID: "proof-legacy-review-document-correlation",
	})
	if err != nil {
		t.Fatalf("create reviewed Finance evidence: %v", err)
	}

	command := exec.CommandContext(ctx, "go", "test", "-C", dshDir, "./internal/order",
		"-run", "^TestRealWLTLegacyCODRecoveryViaDSHOperator$", "-count=1", "-v")
	environment := make([]string, 0, len(os.Environ())+8)
	for _, entry := range os.Environ() {
		if strings.HasPrefix(entry, "WLT_TEST_DATABASE_URL=") ||
			strings.HasPrefix(entry, "DSH_FINANCIAL_HANDOFF_TEST_DATABASE_URL=") ||
			strings.HasPrefix(entry, "BTHWANI_EXPECTED_DATABASE_") {
			continue
		}
		environment = append(environment, entry)
	}
	command.Env = append(environment,
		"BTHWANI_ENV=test",
		"BTHWANI_FINANCIAL_PROOF_ISOLATED=1",
		"DSH_LEGACY_COD_REAL_WLT_URL="+wltURL,
		"DSH_LEGACY_COD_SERVICE_TOKEN="+serviceToken,
		"DSH_LEGACY_COD_PAYMENT_ID="+payment.ID,
		"DSH_LEGACY_COD_EVIDENCE_ID="+evidence.ID,
	)
	out, err := command.CombinedOutput()
	t.Log(string(out))
	if err != nil {
		t.Fatalf("real DSH Finance -> real WLT legacy COD review failed: %v", err)
	}
	review, err := postgres.ReadLegacyCODRecoveryByPayment(ctx, db, payment.ID)
	if err != nil || review.Status != "APPROVED" || review.ApprovedBy != "legacy-finance-approver" ||
		review.SubmittedBy != "legacy-finance-submitter" || review.CaptainActorID != captainID ||
		review.ReservationID == "" {
		t.Fatalf("canonical WLT recovery review readback: %+v err=%v", review, err)
	}
	wallet, err := postgres.ReadCaptainWalletState(ctx, db, captainID)
	if err != nil || wallet.HeldMinor != cash || wallet.AvailableMinor != 20000-cash {
		t.Fatalf("real WLT review created no exact held cover: %+v err=%v", wallet, err)
	}
	t.Log("DSH Finance operators approved the original historical COD and created exact held cover; handoff settlement remains pending")
	return historicalCODReviewProof{orderID: orderID, paymentID: payment.ID, captainID: captainID, cashMinor: cash}
}
