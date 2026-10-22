package postgres

import (
	"context"
	"errors"
	"testing"
)

func TestSettlementIntakePartnerStoreScopeWithoutHold(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, a, b, _, facts, staffFacts, cipher, _ := setupPartnerFinanceProof(t, s, true)
	request := SettlementIntakeInput{
		ActorType: "partner", ActorID: owner, RequestedBy: owner,
		AmountMode: "SPECIFIED", StoreIDs: []string{b, a},
		StoreAmounts:   []SettlementIntakeStore{{StoreID: a, AmountMinor: 1000}, {StoreID: b, AmountMinor: 2000}},
		IdempotencyKey: "partner-settlement-intake-" + s.suffix,
		CorrelationID:  "partner-intake-correlation-" + s.suffix,
	}
	// The exact amount requested must agree with every Store allocation.
	// Reject mismatches before creating an intake or consuming its key.
	for _, wrong := range []int64{2999, 3001, 9223372036854775807} {
		mismatched := request
		mismatched.AmountMinor = &wrong
		if _, _, err := CreateSettlementIntake(s.ctx, s.db, mismatched); !errors.Is(err, ErrSettlementIntakeInvalid) {
			t.Fatalf("Store allocations total 3000 but requested amount %d: %v", wrong, err)
		}
	}
	var pendingBefore int
	if err := s.db.QueryRowContext(s.ctx,
		"SELECT COUNT(*) FROM wlt.beneficiary_settlement_intakes WHERE idempotency_key=$1",
		request.IdempotencyKey).Scan(&pendingBefore); err != nil || pendingBefore != 0 {
		t.Fatalf("invalid amount persisted an intake or consumed its key: count=%d err=%v", pendingBefore, err)
	}
	item, replay, err := CreateSettlementIntake(s.ctx, s.db, request)
	if err != nil || replay || item.ResolvedAmountMinor != 3000 || len(item.StoreAllocations) != 2 {
		t.Fatalf("canonical scoped intake: %+v replay=%v err=%v", item, replay, err)
	}
	t.Cleanup(func() {
		if _, e := s.db.ExecContext(context.Background(), "DELETE FROM wlt.beneficiary_settlement_intakes WHERE id=$1", item.ID); e != nil {
			t.Errorf("cleanup partner intake: %v", e)
		}
	})
	if item.StoreAllocations[0].StoreID != a || item.StoreAllocations[1].StoreID != b {
		t.Fatalf("Store allocations not canonical: %+v", item.StoreAllocations)
	}
	again, replayed, err := CreateSettlementIntake(s.ctx, s.db, request)
	if err != nil || !replayed || again.ID != item.ID {
		t.Fatalf("partner replay: %+v replay=%v err=%v", again, replayed, err)
	}
	// Explicit and derived totals are the same financial request.
	matchingTotal := int64(3000)
	matching := request
	matching.AmountMinor = &matchingTotal
	matchingRecord, replayed, err := CreateSettlementIntake(s.ctx, s.db, matching)
	if err != nil || !replayed || matchingRecord.ID != item.ID ||
		matchingRecord.RequestedAmountMinor == nil || *matchingRecord.RequestedAmountMinor != matchingTotal {
		t.Fatalf("explicit matching amount must replay canonical intake: %+v replay=%v err=%v", matchingRecord, replayed, err)
	}
	var count int
	err = s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.payout_holds WHERE actor_type='partner' AND actor_id=$1", owner).Scan(&count)
	if err != nil || count != 0 {
		t.Fatalf("partner intake must not hold money: count=%d err=%v", count, err)
	}
	// The existing payout path, not the intake, checks verified destinations
	// and creates the actual payout hold before the conversion is acknowledged.
	payout, replay, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, PartnerPayoutRequestInput{
		PartnerActorID: owner, ScopeMode: "SPECIFIED",
		RequestedStoreIDs: []string{a, b},
		StoreAmounts:      []PartnerPayoutStoreAmount{{StoreID: a, AmountMinor: 1000}, {StoreID: b, AmountMinor: 2000}},
		BeneficiaryFacts:  map[string]IdentityFacts{owner: facts, staffFacts.ActorID: staffFacts},
		IdempotencyKey:    "settlement_conv_" + item.ID, CorrelationID: "settlement_conv_corr_" + item.ID,
	})
	if err != nil || replay || payout.TotalAmountMinor != 3000 {
		t.Fatalf("canonical recipient-partitioned payout failed: %+v replay=%v err=%v", payout, replay, err)
	}
	converted, err := ConvertSettlementIntake(s.ctx, s.db, item.ID, payout.ID)
	if err != nil || converted.Status != "CONVERTED" || converted.PayoutStatus != "IN_PROGRESS" {
		t.Fatalf("intake conversion and payout status: %+v err=%v", converted, err)
	}
	repeated, err := ConvertSettlementIntake(s.ctx, s.db, item.ID, payout.ID)
	if err != nil || repeated.PayoutReference == nil || *repeated.PayoutReference != payout.ID {
		t.Fatalf("converted intake replay: %+v err=%v", repeated, err)
	}
}

// A payout with the same beneficiary, total and deterministic key must not
// be linked to an intake when its Store-level entitlements differ.
func TestSettlementIntakeRejectsDifferentPartnerStoreAllocations(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, a, b, _, facts, staffFacts, cipher, _ := setupPartnerFinanceProof(t, s, true)
	request := SettlementIntakeInput{
		ActorType: "partner", ActorID: owner, RequestedBy: owner,
		AmountMode: "SPECIFIED", StoreIDs: []string{a, b},
		StoreAmounts:   []SettlementIntakeStore{{StoreID: a, AmountMinor: 1000}, {StoreID: b, AmountMinor: 2000}},
		IdempotencyKey: "partner-intake-mismatch-" + s.suffix,
		CorrelationID:  "partner-intake-mismatch-correlation-" + s.suffix,
	}
	intake, replayed, err := CreateSettlementIntake(s.ctx, s.db, request)
	if err != nil || replayed {
		t.Fatalf("create request: %+v replayed=%v err=%v", intake, replayed, err)
	}
	t.Cleanup(func() {
		if _, err := s.db.ExecContext(context.Background(), "DELETE FROM wlt.beneficiary_settlement_intakes WHERE id=$1", intake.ID); err != nil {
			t.Errorf("cleanup intake: %v", err)
		}
	})
	payout, _, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, PartnerPayoutRequestInput{
		PartnerActorID: owner, ScopeMode: "SPECIFIED",
		RequestedStoreIDs: []string{a, b},
		StoreAmounts:      []PartnerPayoutStoreAmount{{StoreID: a, AmountMinor: 1500}, {StoreID: b, AmountMinor: 1500}},
		BeneficiaryFacts:  map[string]IdentityFacts{owner: facts, staffFacts.ActorID: staffFacts},
		IdempotencyKey:    "settlement_conv_" + intake.ID, CorrelationID: "settlement_conv_corr_" + intake.ID,
	})
	if err != nil || payout.TotalAmountMinor != intake.ResolvedAmountMinor {
		t.Fatalf("prepare same-total wrong-allocation payout: %+v err=%v", payout, err)
	}
	if _, err := ConvertSettlementIntake(s.ctx, s.db, intake.ID, payout.ID); !errors.Is(err, ErrSettlementIntakeInvalid) {
		t.Fatalf("must reject changed Store allocations despite equal total and key: %v", err)
	}
	unconverted, err := ReadSettlementIntake(s.ctx, s.db, intake.ID)
	if err != nil || unconverted.Status != "REQUESTED" || unconverted.PayoutReference != nil {
		t.Fatalf("rejected conversion must preserve pending intake: %+v err=%v", unconverted, err)
	}
}

// A payout that has released its hold must not be linked as executable.
func TestSettlementIntakeRejectsCancelledPartnerPayout(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	owner, _, a, b, _, facts, staffFacts, cipher, _ := setupPartnerFinanceProof(t, s, true)
	intake, _, err := CreateSettlementIntake(s.ctx, s.db, SettlementIntakeInput{
		ActorType: "partner", ActorID: owner, RequestedBy: owner,
		AmountMode: "SPECIFIED", StoreIDs: []string{a, b},
		StoreAmounts:   []SettlementIntakeStore{{StoreID: a, AmountMinor: 1000}, {StoreID: b, AmountMinor: 2000}},
		IdempotencyKey: "partner-intake-cancelled-" + s.suffix,
		CorrelationID:  "partner-intake-cancelled-correlation-" + s.suffix,
	})
	if err != nil {
		t.Fatalf("create intake: %v", err)
	}
	t.Cleanup(func() {
		if _, err := s.db.ExecContext(context.Background(), "DELETE FROM wlt.beneficiary_settlement_intakes WHERE id=$1", intake.ID); err != nil {
			t.Errorf("cleanup cancelled payout intake: %v", err)
		}
	})
	payout, _, err := CreatePartitionedPartnerPayoutRequest(s.ctx, s.db, cipher, PartnerPayoutRequestInput{
		PartnerActorID: owner, ScopeMode: "SPECIFIED",
		RequestedStoreIDs: []string{a, b},
		StoreAmounts:      []PartnerPayoutStoreAmount{{StoreID: a, AmountMinor: 1000}, {StoreID: b, AmountMinor: 2000}},
		BeneficiaryFacts:  map[string]IdentityFacts{owner: facts, staffFacts.ActorID: staffFacts},
		IdempotencyKey:    "settlement_conv_" + intake.ID, CorrelationID: "settlement_conv_corr_" + intake.ID,
	})
	if err != nil || len(payout.Payouts) == 0 {
		t.Fatalf("create payout for cancellation proof: %+v err=%v", payout, err)
	}
	_, err = CancelPayout(s.ctx, s.db, CancelPayoutInput{
		PayoutID: payout.Payouts[0].ID, ActorID: "finance-operator",
		Reason: "transfer not executed", IdempotencyKey: "cancel-child-" + s.suffix,
		CorrelationID: "cancel-child-correlation-" + s.suffix,
	})
	if err != nil {
		t.Fatalf("cancel held payout: %v", err)
	}
	if _, err = ConvertSettlementIntake(s.ctx, s.db, intake.ID, payout.ID); !errors.Is(err, ErrSettlementIntakeInvalid) {
		t.Fatalf("cancelled underlying payout must not convert intake: %v", err)
	}
}

// The Field reward is posted by WLT using its normal policy/ledger journey.
// A settlement intake must remain available even before a payout destination
// exists, without moving any funds or creating an outstanding payout hold.
func TestSettlementIntakeWithoutDestinationPreservesFieldLedger(t *testing.T) {
	s := newFieldAcquisitionScenario(t)
	s.registerCleanup(t)
	s.activePolicy = s.createAndReplacePolicy(t)
	s.firstAward = s.createAndReplayFirstAward(t)
	key := "field-intake-" + s.suffix
	request := SettlementIntakeInput{ActorType: "field", ActorID: s.actorID, RequestedBy: s.actorID, AmountMode: "FULL_AVAILABLE",
		IdempotencyKey: key, CorrelationID: "intake-correlation-" + s.suffix}
	created, replayed, err := CreateSettlementIntake(s.ctx, s.db, request)
	if err != nil || replayed || created.Status != "REQUESTED" || created.ResolvedAmountMinor != 1250 {
		t.Fatalf("initial nonfinancial intake: %+v replay=%v err=%v", created, replayed, err)
	}
	t.Cleanup(func() {
		if _, err := s.db.ExecContext(s.ctx, "DELETE FROM wlt.beneficiary_settlement_intakes WHERE id=$1", created.ID); err != nil {
			t.Errorf("cleanup intake: %v", err)
		}
	})
	repeated, replayed, err := CreateSettlementIntake(s.ctx, s.db, request)
	if err != nil || !replayed || repeated.ID != created.ID {
		t.Fatalf("intake replay: %+v %v %v", repeated, replayed, err)
	}
	bad := request
	bad.AmountMode = "SPECIFIED"
	small := int64(5)
	bad.AmountMinor = &small
	if _, _, err := CreateSettlementIntake(s.ctx, s.db, bad); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("conflicting replay must fail: %v", err)
	}
	second := request
	second.IdempotencyKey = "field-intake-duplicate-" + s.suffix
	if _, _, err := CreateSettlementIntake(s.ctx, s.db, second); !errors.Is(err, ErrSettlementIntakeOpen) {
		t.Fatalf("second pending request must fail: %v", err)
	}
	var holds int
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.payout_holds WHERE actor_type='field' AND actor_id=$1", s.actorID).Scan(&holds); err != nil || holds != 0 {
		t.Fatalf("intake created payout holds: count=%d err=%v", holds, err)
	}
	var payoutCount int
	if err := s.db.QueryRowContext(s.ctx, "SELECT COUNT(*) FROM wlt.payout_requests WHERE actor_type='field' AND actor_id=$1", s.actorID).Scan(&payoutCount); err != nil || payoutCount != 0 {
		t.Fatalf("intake created actual payout: count=%d err=%v", payoutCount, err)
	}
	if _, err := ConvertSettlementIntake(s.ctx, s.db, created.ID, "payout-that-does-not-exist"); !errors.Is(err, ErrSettlementIntakeInvalid) {
		t.Fatalf("conversion without verified held payout must fail: %v", err)
	}
	intakes, err := ListSettlementIntakes(s.ctx, s.db, "field", s.actorID, "REQUESTED", 50)
	if err != nil || len(intakes) != 1 || intakes[0].ID != created.ID {
		t.Fatalf("canonical inbox readback: %+v err=%v", intakes, err)
	}
	cancelled, err := CancelSettlementIntake(s.ctx, s.db, created.ID, "independent-finance-operator", "verified destination unavailable")
	if err != nil || cancelled.Status != "CANCELLED" || cancelled.CancellationReason != "verified destination unavailable" || cancelled.CancelledAt == nil {
		t.Fatalf("Finance cancellation reason/readback failed: %+v err=%v", cancelled, err)
	}
	second.CorrelationID = "field-second-correlation-" + s.suffix
	newIntake, replay, err := CreateSettlementIntake(s.ctx, s.db, second)
	if err != nil || replay || newIntake.Status != "REQUESTED" {
		t.Fatalf("re-request after cancellation failed: %+v replay=%v err=%v", newIntake, replay, err)
	}
	t.Cleanup(func() {
		_, e := s.db.ExecContext(context.Background(), "DELETE FROM wlt.beneficiary_settlement_intakes WHERE id=$1", newIntake.ID)
		if e != nil {
			t.Errorf("cleanup second intake: %v", e)
		}
	})
}
