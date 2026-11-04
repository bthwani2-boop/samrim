package postgres

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

// This test only runs against WLT_TEST_DATABASE_URL, guarded by
// newFieldAcquisitionScenarioWithTimeout's expected isolated DB check.
// The HTTP server simulates losing the response AFTER the real WLT DB commit.
func TestPaymentRetryLostResponseAndParallelWorkers(t *testing.T) {
	s := newFieldAcquisitionScenarioWithTimeout(t, 3*time.Minute)
	owner, _, _, _, pickupStore, _, _, _, _ := setupPartnerFinanceProof(t, s, true)
	orderID := "retry-proof-" + s.suffix
	customer := "retry-customer-" + s.suffix

	funding, replay, err := CreateCashInFundingIntent(s.ctx, s.db, CreateCashInFundingIntentInput{
		ActorType: "customer", ActorID: customer, AmountMinor: 1200, Currency: "YER",
		ProviderKey: DevelopmentSimulatorProvider, IdempotencyKey: orderID + "-fund",
		CorrelationID: orderID + "-fund-correlation",
	})
	if err != nil || replay {
		t.Fatalf("funding intent replay=%t err=%v", replay, err)
	}
	if _, replay, err = ApplyCashInFundingResult(s.ctx, s.db, ApplyCashInFundingResultInput{
		FundingIntentID: funding.ID, Outcome: "SUCCESS", ActorID: "isolated-simulator",
		ProviderTransactionReference: orderID + "-provider-proof",
		IdempotencyKey:               orderID + "-credit", CorrelationID: orderID + "-credit-correlation",
	}); err != nil || replay {
		t.Fatalf("funding post replay=%t err=%v", replay, err)
	}

	create := CreatePaymentIntentInput{
		ExternalReference: orderID, PayerActorID: customer, OrderID: orderID,
		AmountMinor: 300, Currency: "YER", Method: domain.MethodCashAtStore,
		CustomerPaymentAllocation: &CustomerPaymentAllocationInput{
			OrderID: orderID, StoreID: pickupStore, PartnerActorID: owner,
			CommercialStoreTypeID: "finance-type", FulfillmentMode: "CUSTOMER_PICKUP",
			Currency: "YER", SubtotalMinor: 1500, InternalBalanceAmountMinor: 1200,
			CashAmountMinor: 300, CustomerPayableMinor: 1500, PolicyVersion: "retry-proof-v1",
		},
		IdempotencyKey: orderID + "-create", CorrelationID: orderID + "-create-correlation",
	}
	type result struct {
		record PaymentIntentRecord
		replay bool
		err    error
	}
	const workers = 8
	results := make(chan result, workers)
	start := make(chan struct{})
	var group sync.WaitGroup
	for i := 0; i < workers; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			attempt := create
			allocation := *create.CustomerPaymentAllocation
			attempt.CustomerPaymentAllocation = &allocation
			record, repeated, e := CreatePaymentIntent(s.ctx, s.db, attempt)
			results <- result{record, repeated, e}
		}()
	}
	close(start)
	group.Wait()
	close(results)
	var intent PaymentIntentRecord
	created, repeated := 0, 0
	for outcome := range results {
		if outcome.err != nil {
			t.Fatalf("parallel creation: %v", outcome.err)
		}
		if intent.ID != "" && outcome.record.ID != intent.ID {
			t.Fatalf("duplicate payment intent IDs: %s vs %s", intent.ID, outcome.record.ID)
		}
		intent = outcome.record
		if outcome.replay {
			repeated++
		} else {
			created++
		}
	}
	if created != 1 || repeated != workers-1 || intent.State != domain.StateRequiresCollect {
		t.Fatalf("creation created=%d replayed=%d state=%s", created, repeated, intent.State)
	}
	assertRows := func(query string, want int, args ...any) {
		t.Helper()
		var got int
		if e := s.db.QueryRowContext(s.ctx, query, args...).Scan(&got); e != nil || got != want {
			t.Fatalf("canonical count got=%d want=%d err=%v: %s", got, want, e, query)
		}
	}
	assertRows("SELECT count(*) FROM wlt.payment_intents WHERE external_reference=$1", 1, orderID)
	assertRows("SELECT count(*) FROM wlt.payment_intent_events WHERE intent_id=$1 AND event_type='PAYMENT_INTENT_CREATED'", 1, intent.ID)
	assertRows("SELECT count(*) FROM wlt.customer_payment_allocations WHERE payment_intent_id=$1", 1, intent.ID)

	// The original creation response can be lost. A same-key replay returns the
	// committed intent, and changed payment policy facts cannot reuse the key.
	recovered, isReplay, err := CreatePaymentIntent(s.ctx, s.db, create)
	if err != nil || !isReplay || recovered.ID != intent.ID {
		t.Fatalf("lost creation response recovery replay=%t err=%v id=%s", isReplay, err, recovered.ID)
	}
	changed := create
	modifiedAllocation := *create.CustomerPaymentAllocation
	modifiedAllocation.PolicyVersion = "retry-proof-v2"
	changed.CustomerPaymentAllocation = &modifiedAllocation
	if _, _, err := CreatePaymentIntent(s.ctx, s.db, changed); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("same-key changed policy facts must conflict: %v", err)
	}

	before, err := ReadCustomerWalletState(s.ctx, s.db, customer)
	if err != nil || before.LedgerBalanceMinor != 1200 || before.AvailableMinor != 0 {
		t.Fatalf("before collect wallet=%+v err=%v", before, err)
	}
	collect := CollectPaymentIntentInput{
		IntentID: intent.ID, CollectedAmountMinor: 300, CollectedByActorID: owner,
		CollectionReference: orderID + "-cash-receipt", ExpectedVersion: intent.Version,
		IdempotencyKey: orderID + "-collect", CorrelationID: orderID + "-collect-correlation",
	}
	var firstRequest atomic.Bool
	transport := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Idempotency-Key") != collect.IdempotencyKey {
			http.Error(w, "invalid isolated test request", http.StatusBadRequest)
			return
		}
		record, replayed, e := CollectPaymentIntent(r.Context(), s.db, collect)
		if e != nil {
			http.Error(w, e.Error(), http.StatusConflict)
			return
		}
		if firstRequest.CompareAndSwap(false, true) {
			// WLT already committed; the client never sees the reply.
			conn, _, e := w.(http.Hijacker).Hijack()
			if e != nil {
				t.Errorf("hijack: %v", e)
				return
			}
			_ = conn.Close()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			ID     string `json:"id"`
			Replay bool   `json:"replay"`
		}{record.ID, replayed})
	}))
	defer transport.Close()
	post := func() (*http.Response, error) {
		req, e := http.NewRequestWithContext(s.ctx, http.MethodPost, transport.URL, http.NoBody)
		if e != nil {
			return nil, e
		}
		req.Header.Set("Idempotency-Key", collect.IdempotencyKey)
		return (&http.Client{Timeout: 10 * time.Second}).Do(req)
	}
	lost, err := post()
	if lost != nil {
		_ = lost.Body.Close()
	}
	if err == nil {
		t.Fatal("transport must lose the committed collection response")
	}
	persisted, err := ReadPaymentIntent(s.ctx, s.db, intent.ID)
	if err != nil || persisted.State != domain.StateCollected || persisted.Version != intent.Version+1 {
		t.Fatalf("after disconnected response: %+v err=%v", persisted, err)
	}
	reply, err := post()
	if err != nil {
		t.Fatalf("retry same key after lost response: %v", err)
	}
	defer reply.Body.Close()
	var body struct {
		ID     string `json:"id"`
		Replay bool   `json:"replay"`
	}
	if reply.StatusCode != http.StatusOK || json.NewDecoder(reply.Body).Decode(&body) != nil || body.ID != intent.ID || !body.Replay {
		t.Fatalf("retry status=%d body=%+v", reply.StatusCode, body)
	}
	// Multiple processors retry the exact same post-commit result.
	retries := make(chan error, workers)
	start = make(chan struct{})
	for i := 0; i < workers; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			r, again, e := CollectPaymentIntent(s.ctx, s.db, collect)
			if e == nil && (!again || r.ID != intent.ID) {
				e = fmt.Errorf("not a replay: %+v replay=%t", r, again)
			}
			retries <- e
		}()
	}
	close(start)
	group.Wait()
	close(retries)
	for e := range retries {
		if e != nil {
			t.Fatal(e)
		}
	}
	different := collect
	different.IdempotencyKey = orderID + "-second-collect"
	if _, _, err := CollectPaymentIntent(s.ctx, s.db, different); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("different key cannot collect an already collected intent: %v", err)
	}
	assertRows("SELECT count(*) FROM wlt.payment_intent_events WHERE intent_id=$1 AND event_type='PAYMENT_INTENT_COLLECTED'", 1, intent.ID)

	// Two independent collection workers race on a second unallocated intent.
	second, _, err := CreatePaymentIntent(s.ctx, s.db, CreatePaymentIntentInput{
		ExternalReference: orderID + "-race", PayerActorID: customer,
		AmountMinor: 300, Currency: "YER", Method: domain.MethodCashAtStore,
		IdempotencyKey: orderID + "-race-create", CorrelationID: orderID + "-race-create-correlation",
	})
	if err != nil {
		t.Fatal(err)
	}
	outcomes := make(chan error, 2)
	start = make(chan struct{})
	for i := 0; i < 2; i++ {
		input := CollectPaymentIntentInput{
			IntentID: second.ID, CollectedAmountMinor: 300, CollectedByActorID: owner,
			CollectionReference: orderID + "-race-receipt", ExpectedVersion: second.Version,
			IdempotencyKey: fmt.Sprintf("%s-race-worker-%d", orderID, i),
			CorrelationID:  fmt.Sprintf("%s-race-correlation-%d", orderID, i),
		}
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			_, _, e := CollectPaymentIntent(s.ctx, s.db, input)
			outcomes <- e
		}()
	}
	close(start)
	group.Wait()
	close(outcomes)
	wins, conflicts := 0, 0
	for e := range outcomes {
		switch {
		case e == nil:
			wins++
		case errors.Is(e, ErrVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected parallel-worker outcome: %v", e)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("two workers: wins=%d conflicts=%d", wins, conflicts)
	}
	assertRows("SELECT count(*) FROM wlt.payment_intent_events WHERE intent_id=$1 AND event_type='PAYMENT_INTENT_COLLECTED'", 1, second.ID)

	after, err := ReadCustomerWalletState(s.ctx, s.db, customer)
	if err != nil || after.LedgerBalanceMinor != before.LedgerBalanceMinor || after.AvailableMinor != before.AvailableMinor {
		t.Fatalf("duplicate financial effect: before=%+v after=%+v err=%v", before, after, err)
	}
	// Every posted ledger transaction remains balanced, including customer
	// simulator funding and any effects from the checkout payment allocation.
	var unbalanced int
	err = s.db.QueryRowContext(s.ctx, "SELECT count(*) FROM (SELECT t.id FROM wlt.ledger_transactions t LEFT JOIN wlt.ledger_entries e ON e.transaction_id=t.id GROUP BY t.id HAVING count(e.transaction_id)=0 OR COALESCE(sum(CASE WHEN e.direction='DEBIT' THEN e.amount_minor ELSE -e.amount_minor END),0)<>0) bad").Scan(&unbalanced)
	if err != nil || unbalanced != 0 {
		t.Fatalf("unbalanced WLT transactions=%d err=%v", unbalanced, err)
	}
	var posted int
	if err := s.db.QueryRowContext(s.ctx, "SELECT count(*) FROM wlt.ledger_transactions").Scan(&posted); err != nil || posted == 0 {
		t.Fatalf("no WLT ledger evidence: %d err=%v", posted, err)
	}
}
