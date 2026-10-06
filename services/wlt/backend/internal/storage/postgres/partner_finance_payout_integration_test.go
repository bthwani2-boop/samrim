package postgres

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

func TestPartnerStoreFinanceAndRecipientSettlementLifecycle(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, staff, a, b, c, facts, staffFacts, cipher, earn := setupPartnerFinanceProof(t, s, true)
	rows, err := ReadPartnerStoreFinance(s.ctx, s.db, owner, nil)
	if err != nil || len(rows) != 3 {
		t.Fatalf("all-store readback: %+v %v", rows, err)
	}
	if rows[0].StoreID != a || rows[0].EligibleAvailableMinor != 4400 || rows[1].StoreID != b || rows[1].EligibleAvailableMinor != 8100 || rows[2].EligibleAvailableMinor != 0 {
		t.Fatalf("canonical Store offsets: %+v", rows)
	}
	input := PartnerPayoutRequestInput{PartnerActorID: owner, ScopeMode: PartnerPayoutScopeSpecified, RequestedStoreIDs: []string{a, b}, StoreAmounts: []PartnerPayoutStoreAmount{{StoreID: a, AmountMinor: 1000}, {StoreID: b, AmountMinor: 2000}}, BeneficiaryFacts: map[string]IdentityFacts{owner: facts, staff: staffFacts}, IdempotencyKey: "specified-" + s.suffix, CorrelationID: "specified-correlation-" + s.suffix}
	partial, replay, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, input)
	if err != nil || replay || partial.TotalAmountMinor != 3000 || len(partial.Payouts) != 2 || len(partial.Stores) != 2 {
		t.Fatalf("specified payout: %+v replay=%v err=%v", partial, replay, err)
	}
	if partial.Stores[0].AmountMinor != 1000 || partial.Stores[1].AmountMinor != 2000 || partial.Stores[1].BeneficiaryActorID != staff {
		t.Fatalf("exact allocation: %+v", partial.Stores)
	}
	changed := staffFacts
	changed.ActorVersion++
	input.BeneficiaryFacts[staff] = changed
	if repeated, replayed, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, input); err != nil || !replayed || repeated.ID != partial.ID {
		t.Fatalf("immutable retry: %+v %v %v", repeated, replayed, err)
	}
	input.BeneficiaryFacts[staff] = staffFacts
	stale := input
	stale.IdempotencyKey = "stale-" + s.suffix
	stale.RequestedStoreIDs = []string{a}
	stale.StoreAmounts = []PartnerPayoutStoreAmount{{StoreID: a, AmountMinor: 4400}}
	if _, _, err = CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, stale); !errors.Is(err, ErrPartnerPayoutAmountExceeded) {
		t.Fatalf("stale amount must fail: %v", err)
	}
	var staffPayout PayoutRequestRecord
	// Locate the staff child by its frozen destination rather than group order.
	for _, p := range partial.Payouts {
		d, e := ReadOfficialWalletDestinationByID(s.ctx, s.db, p.DestinationID)
		if e != nil {
			t.Fatal(e)
		}
		if d.ActorID == staff {
			staffPayout = p
		}
	}
	prepared, err := PreparePayout(s.ctx, s.db, cipher, PreparePayoutInput{PayoutID: staffPayout.ID, ActorID: "finance-preparer", Reason: "staff settlement proof", Evidence: "verified staff evidence", IdentityFacts: staffFacts, IdempotencyKey: "prepare-staff-" + s.suffix, CorrelationID: "prepare-staff-correlation-" + s.suffix})
	if err != nil || prepared.Status != "PREPARED" {
		t.Fatalf("staff beneficiary prepare: %+v err=%v", prepared, err)
	}
	approved, err := ApprovePayout(s.ctx, s.db, cipher, ApprovePayoutInput{PayoutID: staffPayout.ID, ActorID: "finance-independent-approver", Reason: "approved staff payout", IdentityFacts: staffFacts, IdempotencyKey: "approve-staff-" + s.suffix, CorrelationID: "approve-staff-correlation-" + s.suffix})
	if err != nil || approved.Status != "APPROVED" || approved.ActorID != owner || approved.BeneficiaryActorID != staff {
		t.Fatalf("wallet owner and beneficiary separation: %+v %v", approved, err)
	}
	if _, err := MarkStorePayoutRecipientReviewRequired(s.ctx, s.db, b, owner, "staff relationship revoked", b+"-review-correlation"); err != nil {
		t.Fatal(err)
	}
	full := PartnerPayoutRequestInput{PartnerActorID: owner, ScopeMode: PartnerPayoutScopeFullAvailable, RequestedStoreIDs: []string{a, b, c}, BeneficiaryFacts: map[string]IdentityFacts{owner: facts, staff: staffFacts}, IdempotencyKey: "full-review-" + s.suffix, CorrelationID: "full-review-correlation-" + s.suffix}
	if _, _, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, full); !errors.Is(err, ErrPayoutRecipientReviewRequired) {
		t.Fatalf("included recipient review must block: %v", err)
	}
	// Two concurrent retries hold A's remaining 3400 exactly once. B's broken
	// future readiness cannot deny an independently authorized A allocation.
	concurrent := full
	concurrent.RequestedStoreIDs = []string{a}
	concurrent.IdempotencyKey = "concurrent-" + s.suffix
	type outcome struct {
		record PartnerPayoutRequestRecord
		replay bool
		err    error
	}
	start := make(chan struct{})
	done := make(chan outcome, 2)
	for range 2 {
		go func() {
			<-start
			r, replay, e := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, concurrent)
			done <- outcome{r, replay, e}
		}()
	}
	close(start)
	one, two := <-done, <-done
	if one.err != nil || two.err != nil || one.record.ID != two.record.ID || one.replay == two.replay || one.record.TotalAmountMinor != 3400 {
		t.Fatalf("concurrent payout: first=%+v replay=%v err=%v; second=%+v replay=%v err=%v", one.record, one.replay, one.err, two.record, two.replay, two.err)
	}
	scoped, err := ReadPartnerStoreFinance(s.ctx, s.db, owner, []string{a})
	if err != nil || len(scoped) != 1 || scoped[0].StoreID != a || scoped[0].EligibleAvailableMinor != 0 || scoped[0].HeldMinor != 4400 {
		t.Fatalf("canonical scoped readback after mutation: %+v %v", scoped, err)
	}
	if _, _, err = CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, PartnerPayoutRequestInput{PartnerActorID: owner, ScopeMode: PartnerPayoutScopeFullAvailable, RequestedStoreIDs: []string{a}, BeneficiaryFacts: map[string]IdentityFacts{owner: facts}, IdempotencyKey: "stale-full-" + s.suffix, CorrelationID: "stale-full-correlation-" + s.suffix}); !errors.Is(err, ErrPayoutNoFunds) {
		t.Fatalf("different concurrent/stale intent must not consume held funds: %v", err)
	}
	if _, err = RevertStorePayoutRecipientToOwner(s.ctx, s.db, RevertStorePayoutRecipientInput{StoreID: b, PartnerActorID: owner, Reason: "owner reconfirms future routing", IdempotencyKey: b + "-revert", CorrelationID: b + "-revert-correlation"}); err != nil {
		t.Fatal(err)
	}
	full.IdempotencyKey = "full-future-" + s.suffix
	future, replay, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, full)
	if err != nil || replay || future.TotalAmountMinor != 6100 || len(future.Stores) != 1 || future.Stores[0].StoreID != b || future.Stores[0].BeneficiaryActorID != owner {
		t.Fatalf("future owner routing: %+v %v %v", future, replay, err)
	}
	historical, err := ReadPartnerPayoutRequest(s.ctx, s.db, partial.ID)
	if err != nil || historical.Stores[1].BeneficiaryActorID != staff || historical.Stores[1].AmountMinor != 2000 {
		t.Fatalf("recipient change rewrote historical allocation: %+v %v", historical, err)
	}
	if _, err = s.db.ExecContext(s.ctx, "UPDATE wlt.payout_store_allocations SET beneficiary_actor_id=$1 WHERE payout_id=$2", owner, staffPayout.ID); err == nil {
		t.Fatal("historical allocation accepted a rewrite")
	}
	batch, err := CreateSettlementBatch(s.ctx, s.db, CreateSettlementBatchInput{PayoutIDs: []string{staffPayout.ID}, ActorID: "finance-batch-preparer", IdentityFactsByBeneficiary: []IdentityFacts{staffFacts}, DestinationCipher: cipher, IdempotencyKey: "batch-" + s.suffix, CorrelationID: "batch-correlation-" + s.suffix})
	if err != nil || len(batch.Items) != 1 || batch.Items[0].ActorID != staff {
		t.Fatalf("historical batch beneficiary after recipient change: %+v %v", batch, err)
	}
	batch, err = ApproveSettlementBatch(s.ctx, s.db, BatchActionInput{BatchID: batch.ID, ActorID: "finance-batch-approver", Reason: "independent batch approval", IdentityFactsByBeneficiary: []IdentityFacts{staffFacts}, DestinationCipher: cipher, IdempotencyKey: "batch-approve-" + s.suffix, CorrelationID: "batch-approve-correlation-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	batch, err = FreezeSettlementBatch(s.ctx, s.db, BatchActionInput{BatchID: batch.ID, ActorID: "finance-batch-freezer", Reason: "freeze historical settlement", IdentityFactsByBeneficiary: []IdentityFacts{staffFacts}, DestinationCipher: cipher, IdempotencyKey: "batch-freeze-" + s.suffix, CorrelationID: "batch-freeze-correlation-" + s.suffix})
	if err != nil || batch.Status != "FROZEN" || batch.Items[0].ActorID != staff || batch.TotalAmountMinor != 2000 {
		t.Fatalf("historical frozen settlement: %+v %v", batch, err)
	}

	receipt, err := SaveFinanceEvidenceDocument(s.ctx, s.db, cipher, FinanceEvidenceDocumentInput{Purpose: "TRANSFER_RECEIPT", Filename: "staff-transfer.pdf", ContentType: "application/pdf", Content: []byte("isolated transfer evidence " + s.suffix), ActorID: "finance-executor", IdempotencyKey: "receipt-" + s.suffix, CorrelationID: "receipt-corr-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	transfer, err := RecordManualTransfer(s.ctx, s.db, RecordTransferInput{BatchID: batch.ID, PayoutID: staffPayout.ID, ActorID: "finance-executor", ExternalReference: "staff-external-" + s.suffix, ReceiptDocumentID: receipt.ID, IdempotencyKey: "transfer-" + s.suffix, CorrelationID: "transfer-corr-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	transfer, err = VerifyManualTransfer(s.ctx, s.db, VerifyTransferInput{TransferID: transfer.ID, ActorID: "finance-transfer-verifier", IdempotencyKey: "transfer-verify-" + s.suffix, CorrelationID: "transfer-verify-corr-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	statementEvidence, err := SaveFinanceEvidenceDocument(s.ctx, s.db, cipher, FinanceEvidenceDocumentInput{Purpose: "SETTLEMENT_STATEMENT", Filename: "staff-statement.pdf", ContentType: "application/pdf", Content: []byte("isolated statement evidence " + s.suffix), ActorID: "finance-statement-uploader", IdempotencyKey: "statement-evidence-" + s.suffix, CorrelationID: "statement-evidence-corr-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	statement, err := RegisterSettlementStatement(s.ctx, s.db, SettlementStatementInput{BatchID: batch.ID, ProviderKey: "YEMEN_MOBILE_WALLET", Currency: "YER", PeriodStart: now.Add(-time.Hour), PeriodEnd: now.Add(time.Hour), EvidenceDocumentID: statementEvidence.ID, ActorID: "finance-statement-uploader", IdempotencyKey: "statement-" + s.suffix, CorrelationID: "statement-corr-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	statementRow, err := RecordSettlementStatementRow(s.ctx, s.db, cipher, SettlementStatementRowInput{StatementID: statement.ID, RowSequence: 1, ExternalReference: "staff-external-" + s.suffix, WalletIdentifier: staffFacts.PhoneE164, AmountMinor: 2000, Currency: "YER", TransactionAt: now, ActorID: "finance-statement-recorder", IdempotencyKey: "statement-row-" + s.suffix, CorrelationID: "statement-row-corr-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	transfer, err = ReconcileManualTransfer(s.ctx, s.db, cipher, ReconcileTransferInput{TransferID: transfer.ID, StatementRowID: statementRow.ID, ActorID: "finance-reconciler", IdempotencyKey: "reconcile-" + s.suffix, CorrelationID: "reconcile-corr-" + s.suffix})
	if err != nil || transfer.ExecutionStatus != "RECONCILED" {
		t.Fatalf("staff transfer reconciliation: %+v %v", transfer, err)
	}
	completed, err := ReadPayoutRequest(s.ctx, s.db, staffPayout.ID)
	if err != nil || completed.Status != "COMPLETED" || completed.ActorID != owner || completed.BeneficiaryActorID != staff {
		t.Fatalf("completed historical payout: %+v %v", completed, err)
	}
	rows, err = ReadPartnerStoreFinance(s.ctx, s.db, owner, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if !row.AttributionComplete {
			t.Fatalf("settlement lost canonical attribution: %+v", rows)
		}
	}
	ownerSummary, err := ReadPartnerFinancialSummary(s.ctx, s.db, owner)
	if err != nil || ownerSummary.EligibleAvailableMinor != 0 || ownerSummary.HeldMinor != 10500 || ownerSummary.SettledMinor != 2000 {
		t.Fatalf("owner final readback: %+v %v", ownerSummary, err)
	}
	var ownerDebit, staffBalance int64
	if err = s.db.QueryRowContext(s.ctx, `SELECT COALESCE(SUM(amount_minor),0) FROM wlt.ledger_entries WHERE transaction_id=$1 AND account_code='PARTNER_WALLET' AND actor_id=$2 AND direction='DEBIT'`, completed.LedgerTransactionID, owner).Scan(&ownerDebit); err != nil {
		t.Fatal(err)
	}
	if err = s.db.QueryRowContext(s.ctx, `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0) FROM wlt.ledger_entries WHERE account_code='PARTNER_WALLET' AND actor_id=$1`, staff).Scan(&staffBalance); err != nil {
		t.Fatal(err)
	}
	if ownerDebit != 2000 || staffBalance != 0 {
		t.Fatalf("settlement debited wrong wallet: owner debit=%d staff balance=%d", ownerDebit, staffBalance)
	}
	recovered, err := ReadPartnerPayoutRequestByKey(s.ctx, s.db, owner, input.IdempotencyKey)
	if err != nil || recovered.ID != partial.ID {
		t.Fatalf("saved request recovery: %+v %v", recovered, err)
	}
	if _, err = ReadPartnerPayoutRequestByKey(s.ctx, s.db, staff, input.IdempotencyKey); !errors.Is(err, ErrPayoutNotFound) {
		t.Fatalf("cross-wallet recovery: %v", err)
	}
	// New mutations validate current Identity; an immutable committed retry still replays.
	d := "finance-store-d-" + s.suffix
	earn(d, "BTHWANI_CAPTAIN", 1000)
	changedOwner := facts
	changedOwner.ActorVersion++
	if _, _, err = CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, PartnerPayoutRequestInput{PartnerActorID: owner, ScopeMode: PartnerPayoutScopeFullAvailable, RequestedStoreIDs: []string{d}, BeneficiaryFacts: map[string]IdentityFacts{owner: changedOwner}, IdempotencyKey: "identity-stale-" + s.suffix, CorrelationID: "identity-stale-corr-" + s.suffix}); !errors.Is(err, ErrReverificationRequired) {
		t.Fatalf("stale recipient Identity: %v", err)
	}
	staleReadback, e := ReadPartnerStoreFinance(s.ctx, s.db, owner, []string{d})
	if e != nil || len(staleReadback) != 1 || staleReadback[0].PayoutReady || staleReadback[0].EligibleAvailableMinor != 900 || staleReadback[0].HeldMinor != 0 {
		t.Fatalf("canonical readback after rejected stale mutation: %+v %v", staleReadback, e)
	}
	if recovered, replayed, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, input); err != nil || !replayed || recovered.ID != partial.ID {
		t.Fatalf("committed retry after staleness: %+v %v %v", recovered, replayed, err)
	}
	if _, _, err := CreatePayoutIntent(s.ctx, s.db, cipher, PayoutIntentInput{ActorType: "partner", ActorID: owner, AmountMode: "FULL_AVAILABLE", IdentityFacts: facts, IdempotencyKey: "generic-" + s.suffix, CorrelationID: "generic-correlation-" + s.suffix}); !errors.Is(err, ErrPartnerPayoutScopeRequired) {
		t.Fatalf("unscoped Partner mutation remained available: %v", err)
	}
}

func setupPartnerFinanceProof(t *testing.T, s *fieldAcquisitionScenario, multiStore bool) (owner, staff, a, b, c string, facts, staffFacts IdentityFacts, cipher *DestinationCipher, earn func(string, string, int64)) {
	t.Helper()
	owner = "finance-owner-" + s.suffix
	staff = "finance-staff-" + s.suffix
	a, b, c = "finance-store-a-"+s.suffix, "finance-store-b-"+s.suffix, "finance-store-c-"+s.suffix
	profile, _, err := PreparePartnerFinancialProfile(s.ctx, s.db, PreparePartnerFinancialProfileInput{JoiningCaseID: "finance-case-" + s.suffix, PartnerActorID: owner, Origin: domain.OriginControlPanel, SettlementPeriod: domain.SettlementWeekly, IdempotencyKey: "profile-" + s.suffix, CorrelationID: "profile-correlation-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	profile, _, err = ActivatePartnerFinancialProfile(s.ctx, s.db, ActivatePartnerFinancialProfileInput{ProfileID: profile.ID, ExpectedVersion: profile.Version, ActorID: "finance-approver", IdempotencyKey: "activate-" + s.suffix, CorrelationID: "activate-correlation-" + s.suffix})
	if err != nil {
		t.Fatal(err)
	}
	// Fixture setup follows canonical agreement, payment collection and earnings
	// commands. No balance or payout state is fabricated directly in storage.
	earn = func(store, mode string, subtotal int64) {
		t.Helper()
		agreement, _, err := ProposeStoreCommercialAgreement(s.ctx, s.db, ProposeStoreCommercialAgreementInput{StoreID: store, PartnerActorID: owner, Rates: []StoreCommercialAgreementRate{{FulfillmentMode: mode, CommissionRateBps: 1000}}, ActorID: "finance-proposer", Reason: "isolated finance proof", IdempotencyKey: store + "-propose", CorrelationID: store + "-propose-correlation"})
		if err != nil {
			t.Fatal(err)
		}
		agreement, _, err = AcceptStoreCommercialAgreement(s.ctx, s.db, agreement.AgreementID, agreement.AgreementVersion, owner, "accepted for isolated proof", store+"-accept", store+"-accept-correlation")
		if err != nil {
			t.Fatal(err)
		}
		_, _, err = DecideStoreCommercialAgreement(s.ctx, s.db, StoreCommercialAgreementDecisionInput{AgreementID: agreement.AgreementID, ExpectedVersion: agreement.AgreementVersion, Decision: "APPROVE", ActorID: "finance-approver", CurrentStorePartnerActorID: owner, CurrentFulfillmentModes: []string{mode}, Reason: "isolated finance proof", IdempotencyKey: store + "-approve", CorrelationID: store + "-approve-correlation"})
		if err != nil {
			t.Fatal(err)
		}
		method := domain.MethodCashOnDelivery
		if mode == "CUSTOMER_PICKUP" {
			method = domain.MethodCashAtStore
		}
		order := store + "-order"
		payment, _, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{ExternalReference: store + "-payment", PayerActorID: "finance-customer-" + s.suffix, OrderID: order, AmountMinor: subtotal, Currency: "YER", Method: method, CustomerPaymentAllocation: &CustomerPaymentAllocationInput{OrderID: order, StoreID: store, PartnerActorID: owner, CommercialStoreTypeID: "finance-type", FulfillmentMode: mode, Currency: "YER", SubtotalMinor: subtotal, CashAmountMinor: subtotal, CustomerPayableMinor: subtotal, PolicyVersion: "finance-proof"}, IdempotencyKey: store + "-payment-key", CorrelationID: store + "-payment-correlation"})
		if err != nil {
			t.Fatal(err)
		}
		collector := "finance-captain-" + s.suffix
		if mode == "CUSTOMER_PICKUP" {
			collector = owner
		}
		_, _, err = CollectPaymentIntent(s.ctx, s.db, CollectPaymentIntentInput{IntentID: payment.ID, CollectedAmountMinor: subtotal, CollectedByActorID: collector, CollectionReference: store + "-collect", ExpectedVersion: payment.Version, IdempotencyKey: store + "-collect-key", CorrelationID: store + "-collect-correlation"})
		if err != nil {
			t.Fatal(err)
		}
		if mode == "CUSTOMER_PICKUP" {
			_, _, err = RecordPartnerStoreCashCommission(s.ctx, s.db, PartnerStoreCashCommissionInput{OrderID: order, PaymentIntentID: payment.ID, PartnerActorID: owner, FulfillmentMode: mode, IdempotencyKey: store + "-earn", CorrelationID: store + "-earn-correlation"})
		} else {
			_, _, err = FinalizePartnerOrderEarning(s.ctx, s.db, FinalizePartnerOrderEarningInput{OrderID: order, PaymentIntentID: payment.ID, PartnerActorID: owner, CaptainActorID: "finance-captain-" + s.suffix, IdempotencyKey: store + "-earn", CorrelationID: store + "-earn-correlation"})
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if multiStore {
		earn(c, "CUSTOMER_PICKUP", 1000)
	}
	earn(a, "BTHWANI_CAPTAIN", 5000)
	if multiStore {
		earn(b, "BTHWANI_CAPTAIN", 9000)
	}
	facts = validIdentityFactsFixture()
	facts.ActorID = owner
	staffFacts = facts
	staffFacts.ActorID = staff
	staffFacts.PhoneE164 = "+967777000002"
	staffFacts.OfficialName = "Canonical Staff"
	cipher, err = NewDestinationCipher("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range []IdentityFacts{facts, staffFacts} {
		d, _, err := CreateOfficialWalletDestination(s.ctx, s.db, cipher, CreateOfficialWalletDestinationInput{ActorType: "partner", ActorID: f.ActorID, ProviderKey: "YEMEN_MOBILE_WALLET", IdentityFacts: f, ChangeReason: "isolated proof", VerificationEvidenceReference: f.ActorID + "-verify", ChangeEvidenceReference: f.ActorID + "-change", SubmittedBy: "finance-submitter", IdempotencyKey: f.ActorID + "-destination", CorrelationID: f.ActorID + "-destination-correlation"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = VerifyOfficialWalletDestination(s.ctx, s.db, cipher, d.ID, "finance-verifier", f.ActorID+"-evidence", f, f.ActorID+"-verify-key", f.ActorID+"-verify-correlation"); err != nil {
			t.Fatal(err)
		}
		if _, err = ActivateOfficialWalletDestination(s.ctx, s.db, cipher, d.ID, "finance-approver", f, f.ActorID+"-activate-key", f.ActorID+"-activate-correlation"); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err = SelectStorePayoutRecipient(s.ctx, s.db, cipher, SelectStorePayoutRecipientInput{StoreID: b, PartnerActorID: owner, BeneficiaryActorID: staff, BeneficiaryFacts: staffFacts, Reason: "owner-selected staff", IdempotencyKey: b + "-recipient", CorrelationID: b + "-recipient-correlation"}); err != nil {
		t.Fatal(err)
	}
	return
}

func TestPartnerFullAvailableIncludesEveryAuthorizedStoreBeyondLegacyLimit(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, a, _, _, facts, _, cipher, earn := setupPartnerFinanceProof(t, s, false)
	ids := []string{a}
	for index := range 200 {
		id := fmt.Sprintf("finance-scale-%d-%s", index, s.suffix)
		earn(id, "BTHWANI_CAPTAIN", 1000)
		ids = append(ids, id)
	}
	record, _, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, PartnerPayoutRequestInput{PartnerActorID: owner, ScopeMode: PartnerPayoutScopeFullAvailable, RequestedStoreIDs: ids, BeneficiaryFacts: map[string]IdentityFacts{owner: facts}, IdempotencyKey: "scale-all-" + s.suffix, CorrelationID: "scale-all-corr-" + s.suffix})
	if err != nil || len(record.Stores) != 201 || record.TotalAmountMinor != 184500 {
		t.Fatalf("full payout must cover complete authorized Store scope: stores=%d amount=%d err=%v", len(record.Stores), record.TotalAmountMinor, err)
	}
	var total int64
	for _, store := range record.Stores {
		total += store.AmountMinor
	}
	if total != record.TotalAmountMinor {
		t.Fatalf("allocation total %d != canonical request %d", total, record.TotalAmountMinor)
	}
}
