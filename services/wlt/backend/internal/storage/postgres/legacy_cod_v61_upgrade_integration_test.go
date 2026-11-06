package postgres

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
)

// Prove the real v60 -> v61 upgrade preserves a collected payment, its
// allocation, uploaded evidence, and already-posted wallet funding.
// This test must run only in a pristine, explicitly named disposable database.
func TestLegacyCODV61UpgradePreservesHistoricalCollectedPayment(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_MIGRATION_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WLT_MIGRATION_TEST_DATABASE_URL is not configured")
	}
	if _, err := opsafety.RequireOrdinaryCLIEnvironment(os.Getenv("BTHWANI_ENV"), "WLT v61 migration proof"); err != nil {
		t.Fatal(err)
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatalf("refuse non-dedicated migration target: %v", err)
	}
	db, err := Open(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	if err := db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	var pristine bool
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('wlt.schema_migrations') IS NULL AND to_regclass('wlt.payment_intents') IS NULL").Scan(&pristine); err != nil || !pristine {
		t.Fatalf("refuse nonempty or unreadable migration database: pristine=%v err=%v", pristine, err)
	}
	records, statements, err := LoadMigrations(filepath.Join("..", "..", "..", "..", "database", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if err := applyWLTMigrationPrefix(ctx, db, records, statements, 60); err != nil {
		t.Fatalf("prepare canonical v60 schema: %v", err)
	}

	const orderID = "v61-historical-order"
	const captainID = "v61-original-collector"
	const amount = int64(5500)
	// V60 already requires an active, consented Store commercial agreement.
	// Establish it through WLT's real owner commands, not an SQL shortcut.
	profile, _, err := PreparePartnerFinancialProfile(ctx, db, PreparePartnerFinancialProfileInput{
		JoiningCaseID: "v61-partner-case", PartnerActorID: "v61-partner",
		Origin: domain.OriginControlPanel, SettlementPeriod: domain.SettlementWeekly,
		IdempotencyKey: "v61-profile-prepare", CorrelationID: "v61-profile-prepare-correlation",
	})
	if err != nil {
		t.Fatalf("prepare v60 partner: %v", err)
	}
	if _, _, err := ActivatePartnerFinancialProfile(ctx, db, ActivatePartnerFinancialProfileInput{
		ProfileID: profile.ID, ExpectedVersion: profile.Version, ActorID: "v61-finance-profile-approver",
		IdempotencyKey: "v61-profile-activate", CorrelationID: "v61-profile-activate-correlation",
	}); err != nil {
		t.Fatalf("activate v60 partner: %v", err)
	}
	agreement, _, err := ProposeStoreCommercialAgreement(ctx, db, ProposeStoreCommercialAgreementInput{
		StoreID: "v61-store", PartnerActorID: "v61-partner",
		Rates:   []StoreCommercialAgreementRate{{FulfillmentMode: "BTHWANI_CAPTAIN", CommissionRateBps: 1000}},
		ActorID: "v61-agreement-proposer", Reason: "isolated historical v60 upgrade fixture",
		IdempotencyKey: "v61-agreement-propose", CorrelationID: "v61-agreement-propose-correlation",
	})
	if err != nil {
		t.Fatalf("propose v60 Store agreement: %v", err)
	}
	agreement, _, err = AcceptStoreCommercialAgreement(ctx, db, agreement.AgreementID, agreement.AgreementVersion,
		"v61-partner", "partner accepted terms", "v61-agreement-accept", "v61-agreement-accept-correlation")
	if err != nil {
		t.Fatalf("accept v60 Store agreement: %v", err)
	}
	if _, _, err := DecideStoreCommercialAgreement(ctx, db, StoreCommercialAgreementDecisionInput{
		AgreementID: agreement.AgreementID, ExpectedVersion: agreement.AgreementVersion,
		Decision: "APPROVE", ActorID: "v61-agreement-finance-approver",
		CurrentStorePartnerActorID: "v61-partner", CurrentFulfillmentModes: []string{"BTHWANI_CAPTAIN"},
		Reason: "approved historical Store", IdempotencyKey: "v61-agreement-approve",
		CorrelationID: "v61-agreement-approve-correlation",
	}); err != nil {
		t.Fatalf("approve v60 Store agreement: %v", err)
	}
	payment, replay, err := CreatePaymentIntent(ctx, db, CreatePaymentIntentInput{
		ExternalReference: "v61-historical-payment", PayerActorID: "v61-customer",
		OrderID: orderID, AmountMinor: amount, Currency: "YER", Method: domain.MethodCashOnDelivery,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: orderID, StoreID: "v61-store", PartnerActorID: "v61-partner",
			CommercialStoreTypeID: "v61-store-type", FulfillmentMode: "BTHWANI_CAPTAIN",
			Currency: "YER", SubtotalMinor: 5000, DeliveryFeeMinor: 500,
			CashAmountMinor: amount, CustomerPayableMinor: amount, PolicyVersion: "v60-policy",
		},
		IdempotencyKey: "v61-payment-create", CorrelationID: "v61-payment-create-correlation",
	})
	if err != nil || replay {
		t.Fatalf("create v60 payment: replay=%v err=%v", replay, err)
	}
	// Model a pre-hold COLLECTED row only inside the task-owned empty database.
	// The production repair must never fabricate or rewrite this financial state.
	result, err := db.ExecContext(ctx, `UPDATE wlt.payment_intents SET state='COLLECTED',
		version=version+1,collected_amount_minor=$2,collected_by_actor_id=$3,
		collection_reference='v60-receipt',collected_at=clock_timestamp(),
		updated_at=clock_timestamp()
		WHERE id=$1 AND state='REQUIRES_COLLECTION'`, payment.ID, amount, captainID)
	if err != nil {
		t.Fatal(err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		t.Fatalf("v60 collected fixture affected=%d err=%v", affected, err)
	}
	cipher, err := NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := SaveFinanceEvidenceDocument(ctx, db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "TRANSFER_RECEIPT", Filename: "v60-original.pdf",
		ContentType: "application/pdf", Content: []byte("%PDF-1.4\nv60 original evidence\n%%EOF"),
		ActorID: "v61-submitter", IdempotencyKey: "v61-original-evidence", CorrelationID: "v61-original-evidence-corr",
	})
	if err != nil {
		t.Fatalf("save v60 evidence: %v", err)
	}
	funding, replay, err := CreateCashInFundingIntent(ctx, db, CreateCashInFundingIntentInput{
		ActorType: "captain", ActorID: captainID, AmountMinor: 20000, Currency: "YER",
		ProviderKey: DevelopmentSimulatorProvider, IdempotencyKey: "v61-funding-intent", CorrelationID: "v61-funding-correlation",
	})
	if err != nil || replay {
		t.Fatalf("fund v60 captain: replay=%v err=%v", replay, err)
	}
	if _, replay, err := ApplyCashInFundingResult(ctx, db, ApplyCashInFundingResultInput{
		FundingIntentID: funding.ID, Outcome: "SUCCESS", ActorID: "v61-test-provider",
		ProviderTransactionReference: "v61-test-provider-transaction",
		IdempotencyKey:               "v61-funding-settled", CorrelationID: "v61-funding-settled-correlation",
	}); err != nil || replay {
		t.Fatalf("settle v60 funding: replay=%v err=%v", replay, err)
	}
	var beforePayment, beforeEvidence string
	if err := db.QueryRowContext(ctx, `SELECT jsonb_build_object('payment',to_jsonb(p),'allocation',to_jsonb(a))::text
		FROM wlt.payment_intents p JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=p.id
		WHERE p.id=$1`, payment.ID).Scan(&beforePayment); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT to_jsonb(e)::text FROM wlt.finance_evidence_documents e WHERE id=$1", receipt.ID).Scan(&beforeEvidence); err != nil {
		t.Fatal(err)
	}
	var beforeLedger int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wlt.ledger_transactions").Scan(&beforeLedger); err != nil {
		t.Fatal(err)
	}
	beforeWallet, err := ReadCaptainWalletState(ctx, db, captainID)
	if err != nil || beforeWallet.AvailableMinor != 20000 || beforeWallet.HeldMinor != 0 || beforeLedger == 0 {
		t.Fatalf("unexpected historical funding: wallet=%+v ledger=%d err=%v", beforeWallet, beforeLedger, err)
	}

	if err := Migrate(ctx, db, records, statements); err != nil {
		t.Fatalf("upgrade WLT v60 to v61: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatalf("verify v61 schema: %v", err)
	}
	if err := Migrate(ctx, db, records, statements); err != nil {
		t.Fatalf("replaying v61 migrations must be safe: %v", err)
	}
	var afterPayment, afterEvidence string
	if err := db.QueryRowContext(ctx, `SELECT jsonb_build_object('payment',to_jsonb(p),'allocation',to_jsonb(a))::text
		FROM wlt.payment_intents p JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=p.id
		WHERE p.id=$1`, payment.ID).Scan(&afterPayment); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT to_jsonb(e)::text FROM wlt.finance_evidence_documents e WHERE id=$1", receipt.ID).Scan(&afterEvidence); err != nil {
		t.Fatal(err)
	}
	var afterLedger, reviews, holds int
	if err := db.QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM wlt.ledger_transactions),
		(SELECT COUNT(*) FROM wlt.captain_cod_legacy_recovery_reviews),
		(SELECT COUNT(*) FROM wlt.captain_cod_reservations WHERE payment_intent_id=$1)`, payment.ID).
		Scan(&afterLedger, &reviews, &holds); err != nil {
		t.Fatal(err)
	}
	afterWallet, err := ReadCaptainWalletState(ctx, db, captainID)
	if err != nil || afterWallet.AvailableMinor != beforeWallet.AvailableMinor || afterWallet.HeldMinor != beforeWallet.HeldMinor ||
		beforePayment != afterPayment || beforeEvidence != afterEvidence || beforeLedger != afterLedger || reviews != 0 || holds != 0 {
		t.Fatalf("v61 migration changed historical facts: payment=%v evidence=%v ledger=%d/%d review=%d hold=%d wallet=%+v err=%v",
			beforePayment == afterPayment, beforeEvidence == afterEvidence, beforeLedger, afterLedger, reviews, holds, afterWallet, err)
	}

	newEvidence, err := SaveFinanceEvidenceDocument(ctx, db, cipher, FinanceEvidenceDocumentInput{
		Purpose: "CAPTAIN_COD_LEGACY_RECOVERY", Filename: "v61-review.pdf",
		ContentType: "application/pdf", Content: []byte("%PDF-1.4\nv61 recovery evidence\n%%EOF"),
		ActorID: "v61-submitter", IdempotencyKey: "v61-recovery-document", CorrelationID: "v61-recovery-document-corr",
	})
	if err != nil {
		t.Fatalf("new v61 purpose rejected: %v", err)
	}
	review, replay, err := SubmitLegacyCODRecovery(ctx, db, LegacyCODRecoveryInput{
		PaymentIntentID: payment.ID, OrderID: orderID, CaptainActorID: captainID,
		EvidenceDocumentID: newEvidence.ID, ActorID: "v61-submitter",
		IdempotencyKey: "v61-recovery-submit", CorrelationID: "v61-recovery-submit-corr",
	})
	if err != nil || replay || review.Status != "PENDING" {
		t.Fatalf("historical payment not eligible for controlled review: review=%+v replay=%v err=%v", review, replay, err)
	}
	if _, _, err := ApproveLegacyCODRecovery(ctx, db, LegacyCODRecoveryApprovalInput{
		ReviewID: review.ID, ActorID: "v61-submitter",
		IdempotencyKey: "v61-self-approval", CorrelationID: "v61-self-approval-correlation",
	}); !errors.Is(err, ErrLegacyCODRecoverySeparation) {
		t.Fatalf("same finance actor approved old payment: %v", err)
	}
}
