package postgres

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// ReadFinancialStatement and the aggregate register are WLT ledger projections,
// not independent balances. Exercise both against actual committed postings in
// a disposable PostgreSQL database owned by the finance proof runner.
func TestFinancialStatementSnapshotLedgerReadbackAndActorIsolation(t *testing.T) {
	s := newFieldAcquisitionScenarioWithTimeout(t, 3*time.Minute)
	first := "statement-first-" + s.suffix
	second := "statement-second-" + s.suffix
	start := time.Now().UTC().Add(-time.Hour)
	end := time.Now().UTC().Add(time.Hour)

	post := func(actor string, index int, amount int64) error {
		key := fmt.Sprintf("statement-%s-%d", actor, index)
		intent, replay, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
			ActorType: "customer", ActorID: actor, AmountMinor: amount, Currency: "YER",
			ProviderKey: DevelopmentSimulatorProvider, IdempotencyKey: key + "-fund",
			CorrelationID: key + "-fund-correlation",
		})
		if err != nil || replay {
			return fmt.Errorf("create funding %s: replay=%t err=%v", key, replay, err)
		}
		_, replay, err = ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
			FundingIntentID: intent.ID, Outcome: "SUCCESS", ActorID: "isolated-simulator",
			ProviderTransactionReference: key + "-provider",
			IdempotencyKey:               key + "-credit", CorrelationID: key + "-credit-correlation",
		})
		if err != nil || replay {
			return fmt.Errorf("post funding %s: replay=%t err=%v", key, replay, err)
		}
		return nil
	}
	var periodAfterFirst time.Time
	for _, item := range []struct {
		actor  string
		index  int
		amount int64
	}{{first, 1, 1200}, {first, 2, 350}, {second, 1, 900}} {
		if err := post(item.actor, item.index, item.amount); err != nil {
			t.Fatal(err)
		}
		if item.actor == first && item.index == 1 {
			if err := s.db.QueryRowContext(s.ctx, "SELECT clock_timestamp()").Scan(&periodAfterFirst); err != nil {
				t.Fatalf("read authoritative PostgreSQL period boundary: %v", err)
			}
		}
	}

	read := func(actor string, limit int, cursorAt *time.Time, cursorID string) FinancialStatementRecord {
		t.Helper()
		record, err := ReadFinancialStatement(s.ctx, s.db, "customer", actor, start, end, cursorAt, cursorID, limit)
		if err != nil {
			t.Fatal(err)
		}
		return record
	}
	a := read(first, 20, nil, "")
	b := read(second, 20, nil, "")
	if len(a.Entries) != 2 || a.CreditsMinor != 1550 || a.ClosingBalance != 1550 || a.CurrentBalance != 1550 || a.DebitsMinor != 0 || a.OpeningBalance != 0 {
		t.Fatalf("first actor's WLT statement inconsistent: %+v", a)
	}
	if len(b.Entries) != 1 || b.CreditsMinor != 900 || b.CurrentBalance != 900 || b.Entries[0].AmountMinor != 900 {
		t.Fatalf("second actor's WLT statement leaked or lost entries: %+v", b)
	}
	periodAfterDeposit, err := ReadFinancialStatement(s.ctx, s.db, "customer", first, periodAfterFirst, end, nil, "", 20)
	if err != nil || len(periodAfterDeposit.Entries) != 1 || periodAfterDeposit.OpeningBalance != 1200 ||
		periodAfterDeposit.CreditsMinor != 350 || periodAfterDeposit.ClosingBalance != 1550 ||
		periodAfterDeposit.Entries[0].BalanceAfter != 1550 {
		t.Fatalf("historical WLT opening/closing balance mismatch: %+v err=%v", periodAfterDeposit, err)
	}
	page := read(first, 1, nil, "")
	if len(page.Entries) != 1 || page.NextCursor == "" || page.CreditsMinor != 1550 {
		t.Fatalf("first page must keep full period totals and a real cursor: %+v", page)
	}
	pieces := strings.SplitN(page.NextCursor, "|", 2)
	if len(pieces) != 2 {
		t.Fatalf("invalid statement cursor: %q", page.NextCursor)
	}
	at, err := time.Parse(time.RFC3339Nano, pieces[0])
	if err != nil {
		t.Fatal(err)
	}
	older := read(first, 1, &at, pieces[1])
	if len(older.Entries) != 1 || older.NextCursor != "" || older.Entries[0].TransactionID == page.Entries[0].TransactionID ||
		older.Entries[0].AmountMinor+page.Entries[0].AmountMinor != 1550 || older.ClosingBalance != page.ClosingBalance {
		t.Fatalf("statement pagination duplicated or dropped posted ledger entries: first=%+v older=%+v", page, older)
	}
	summaries, _, _, err := ListFinancialStatementSummaries(s.ctx, s.db, "customer", start, end, "", 200)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, row := range summaries {
		switch row.ActorID {
		case first:
			found++
			if row.CreditsMinor != a.CreditsMinor || row.ClosingBalance != a.ClosingBalance || row.CurrentBalance != a.CurrentBalance {
				t.Fatalf("WLT detail and register disagreed for first actor: %+v", row)
			}
		case second:
			found++
			if row.CreditsMinor != b.CreditsMinor || row.ClosingBalance != b.ClosingBalance || row.CurrentBalance != b.CurrentBalance {
				t.Fatalf("WLT detail and register disagreed for second actor: %+v", row)
			}
		}
	}
	if found != 2 {
		t.Fatalf("expected both isolated WLT actors in canonical register, got %d", found)
	}

	// New postings run concurrently with the two read queries. Every completed
	// response must conserve amounts within one snapshot, never mix an earlier
	// total with a later statement page or vice versa.
	var cutoffBeforePostings time.Time
	if err := s.db.QueryRowContext(s.ctx, "SELECT clock_timestamp()").Scan(&cutoffBeforePostings); err != nil {
		t.Fatalf("read authoritative PostgreSQL historic cutoff: %v", err)
	}
	startWriting := make(chan struct{})
	writeResult := make(chan error, 1)
	go func() {
		<-startWriting
		for i := 3; i <= 17; i++ {
			if err := post(first, i, 10); err != nil {
				writeResult <- err
				return
			}
		}
		writeResult <- nil
	}()
	close(startWriting)
	for i := 0; i < 90; i++ {
		statement := read(first, 200, nil, "")
		var sum int64
		for _, entry := range statement.Entries {
			if entry.Direction != "CREDIT" || entry.Currency != "YER" {
				t.Fatalf("unexpected statement ledger direction or currency: %+v", entry)
			}
			sum += entry.AmountMinor
		}
		if sum != statement.CreditsMinor || statement.ClosingBalance != sum || statement.CurrentBalance != sum || statement.DebitsMinor != 0 {
			t.Fatalf("torn financial ledger snapshot under concurrent posting: total=%d entriesSum=%d current=%d closing=%d", statement.CreditsMinor, sum, statement.CurrentBalance, statement.ClosingBalance)
		}
	}
	if err := <-writeResult; err != nil {
		t.Fatal(err)
	}
	final := read(first, 200, nil, "")
	if len(final.Entries) != 17 || final.CreditsMinor != 1700 || final.ClosingBalance != 1700 {
		t.Fatalf("WLT final persisted statement differs after concurrent postings: %+v", final)
	}
	historic, err := ReadFinancialStatement(s.ctx, s.db, "customer", first, start, cutoffBeforePostings, nil, "", 200)
	if err != nil || len(historic.Entries) != 2 || historic.CreditsMinor != 1550 ||
		historic.ClosingBalance != 1550 || historic.CurrentBalance != 1700 {
		t.Fatalf("historical close must not change when current balance advances: %+v err=%v", historic, err)
	}
}
