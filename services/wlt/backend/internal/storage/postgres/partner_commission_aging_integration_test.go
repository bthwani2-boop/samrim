package postgres

import (
	"fmt"
	"testing"
	"time"
)

// Aging comes from actual commission debits and posted external remittances.
func TestPartnerCommissionRegistryFIFOAgeAfterPartialRemittances(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, _, _, _, _, _, cipher, earn := setupPartnerFinanceProof(t, s, false)
	firstStore := "aging-first-" + s.suffix
	secondStore := "aging-second-" + s.suffix
	earn(firstStore, "CUSTOMER_PICKUP", 1000)
	earn(secondStore, "CUSTOMER_PICKUP", 2000)
	var firstAt, secondAt time.Time
	for _, target := range []struct {
		store string
		at    *time.Time
	}{
		{firstStore, &firstAt}, {secondStore, &secondAt},
	} {
		statement := "SELECT t.created_at FROM wlt.ledger_transactions t " +
			"JOIN wlt.ledger_entries e ON e.transaction_id=t.id " +
			"WHERE e.account_code='PARTNER_COMMISSION_RECEIVABLE' " +
			"AND e.actor_id=$1 AND e.direction='DEBIT' AND t.source_id=$2"
		if err := s.db.QueryRowContext(s.ctx, statement, owner, target.store+"-order").Scan(target.at); err != nil {
			t.Fatal(err)
		}
	}
	read := func(wantBalance int64, wantDate *time.Time) {
		t.Helper()
		records, more, err := ListPartnerCommissionReceivables(s.ctx, s.db, owner, "actor_asc", "", 10)
		if err != nil || more {
			t.Fatalf("registry query: %+v %v", records, err)
		}
		if wantBalance == 0 {
			if len(records) != 0 {
				t.Fatalf("remitted receivable still listed: %+v", records)
			}
			return
		}
		if len(records) != 1 || records[0].PartnerActorID != owner ||
			records[0].OutstandingCommissionReceivableMinor != wantBalance ||
			records[0].OldestUnpaidAt == nil || !records[0].OldestUnpaidAt.Equal(*wantDate) {
			t.Fatalf("balance=%d date=%v registry=%+v", wantBalance, wantDate, records)
		}
	}
	read(300, &firstAt)
	remit := func(amount int64, n int) {
		t.Helper()
		key := fmt.Sprintf("aging-remit-%d-%s", n, s.suffix)
		receipt, err := SaveFinanceEvidenceDocument(s.ctx, s.db, cipher, FinanceEvidenceDocumentInput{
			Purpose: "TRANSFER_RECEIPT", Filename: "remit-proof.pdf",
			ContentType: "application/pdf",
			Content:     []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"),
			ActorID:     "finance-reconciler", IdempotencyKey: key + "-receipt",
			CorrelationID: key + "-receipt-correlation",
		})
		if err != nil {
			t.Fatal(err)
		}
		record, replay, err := RecordPartnerCommissionRemittance(s.ctx, s.db, PartnerCommissionRemittanceInput{
			PartnerActorID: owner, AmountMinor: amount, RemittanceReference: key + "-provider",
			EvidenceDocumentID: receipt.ID, VerifiedBy: "finance-reconciler",
			IdempotencyKey: key, CorrelationID: key + "-correlation",
		})
		if err != nil || replay || record.AmountMinor != amount {
			t.Fatalf("remit=%+v replay=%t err=%v", record, replay, err)
		}
	}
	remit(100, 1)
	read(200, &secondAt)
	remit(200, 2)
	read(0, nil)
}
