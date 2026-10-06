package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
)

func TestPartnerPayoutV45UpgradePreservesHistoricalBeneficiaries(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_MIGRATION_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WLT_MIGRATION_TEST_DATABASE_URL is not configured")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatal(err)
	}
	db, err := Open(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	var pristine bool
	if err = db.QueryRowContext(ctx, `SELECT to_regclass('wlt.schema_migrations') IS NULL`).Scan(&pristine); err != nil || !pristine {
		t.Fatalf("migration proof requires an empty dedicated database: %v", err)
	}
	records, statements, err := LoadMigrations(filepath.Join("..", "..", "..", "..", "database", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if err = applyWLTMigrationPrefix(ctx, db, records, statements, 45); err != nil {
		t.Fatal(err)
	}
	one := &fieldAcquisitionScenario{ctx: ctx, db: db, suffix: fmt.Sprintf("single-%d", time.Now().UnixNano())}
	owner, _, a, _, _, facts, _, cipher, _ := setupPartnerFinanceProof(t, one, false)
	single, _, err := CreatePartitionedPartnerPayoutRequest(ctx, db, cipher, PartnerPayoutRequestInput{PartnerActorID: owner, ScopeMode: PartnerPayoutScopeSpecified, RequestedStoreIDs: []string{a}, StoreAmounts: []PartnerPayoutStoreAmount{{StoreID: a, AmountMinor: 1000}}, BeneficiaryFacts: map[string]IdentityFacts{owner: facts}, IdempotencyKey: "legacy-single-" + one.suffix, CorrelationID: "legacy-single-corr-" + one.suffix})
	if err != nil {
		t.Fatal(err)
	}
	two := &fieldAcquisitionScenario{ctx: ctx, db: db, suffix: fmt.Sprintf("multiple-%d", time.Now().UnixNano())}
	other, staff, b, c, _, otherFacts, staffFacts, _, _ := setupPartnerFinanceProof(t, two, true)
	multiple, _, err := CreatePartitionedPartnerPayoutRequest(ctx, db, cipher, PartnerPayoutRequestInput{PartnerActorID: other, ScopeMode: PartnerPayoutScopeSpecified, RequestedStoreIDs: []string{b, c}, StoreAmounts: []PartnerPayoutStoreAmount{{StoreID: b, AmountMinor: 1000}, {StoreID: c, AmountMinor: 2000}}, BeneficiaryFacts: map[string]IdentityFacts{other: otherFacts, staff: staffFacts}, IdempotencyKey: "legacy-multiple-" + two.suffix, CorrelationID: "legacy-multiple-corr-" + two.suffix})
	if err != nil {
		t.Fatal(err)
	}
	historical := append(single.Payouts, multiple.Payouts...)
	before := map[string]string{}
	for _, p := range historical {
		beneficiaryFacts := otherFacts
		if p.ActorID == owner {
			beneficiaryFacts = facts
		} else if p.BeneficiaryActorID == staff {
			beneficiaryFacts = staffFacts
		}
		if _, err = PreparePayout(ctx, db, cipher, PreparePayoutInput{PayoutID: p.ID, ActorID: "migration-preparer", Reason: "historical fixture", Evidence: "historical verified evidence", IdentityFacts: beneficiaryFacts, IdempotencyKey: p.ID + "-prepare", CorrelationID: p.ID + "-prepare-corr"}); err != nil {
			t.Fatal(err)
		}
		if _, err = ApprovePayout(ctx, db, cipher, ApprovePayoutInput{PayoutID: p.ID, ActorID: "migration-approver", Reason: "historical fixture approved", IdentityFacts: beneficiaryFacts, IdempotencyKey: p.ID + "-approve", CorrelationID: p.ID + "-approve-corr"}); err != nil {
			t.Fatal(err)
		}
		// The isolated v45 starting fixture models pre-partitioning history: only
		// allocation metadata is absent, while the approved payout and snapshot
		// remain canonical and immutable. No live database is touched.
		if _, err = db.ExecContext(ctx, `DELETE FROM wlt.payout_store_allocations WHERE payout_id=$1`, p.ID); err != nil {
			t.Fatal(err)
		}
		var state string
		if err = db.QueryRowContext(ctx, `SELECT jsonb_build_object('payout',to_jsonb(p),'snapshot',to_jsonb(s))::text FROM wlt.payout_requests p JOIN wlt.approved_payout_snapshots s ON s.payout_id=p.id WHERE p.id=$1`, p.ID).Scan(&state); err != nil {
			t.Fatal(err)
		}
		before[p.ID] = state
	}
	if err = Migrate(ctx, db, records, statements); err != nil {
		t.Fatal(err)
	}
	if err = VerifySchema(ctx, db, records); err != nil {
		t.Fatal(err)
	}
	for _, p := range historical {
		var state string
		if err = db.QueryRowContext(ctx, `SELECT jsonb_build_object('payout',to_jsonb(p),'snapshot',to_jsonb(s))::text FROM wlt.payout_requests p JOIN wlt.approved_payout_snapshots s ON s.payout_id=p.id WHERE p.id=$1`, p.ID).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if state != before[p.ID] {
			t.Fatalf("migration reinterpreted payout/snapshot %s", p.ID)
		}
	}
	rows, err := ReadPartnerStoreFinance(ctx, db, owner, []string{a})
	if err != nil || len(rows) != 1 || !rows[0].AttributionComplete || rows[0].HeldMinor != 1000 || rows[0].EligibleAvailableMinor != 3500 {
		t.Fatalf("proven single-Store historical attribution: %+v %v", rows, err)
	}
	rows, err = ReadPartnerStoreFinance(ctx, db, other, []string{b, c})
	if err != nil || len(rows) != 2 || rows[0].AttributionComplete || rows[1].AttributionComplete {
		t.Fatalf("ambiguous history must remain explicit: %+v %v", rows, err)
	}
	summary, err := ReadPartnerFinancialSummary(ctx, db, other)
	if err != nil || summary.EligibleAvailableMinor != 9500 || summary.HeldMinor != 3000 {
		t.Fatalf("canonical balance with ambiguous allocations: %+v %v", summary, err)
	}
	if _, _, err = CreatePartitionedPartnerPayoutRequest(ctx, db, cipher, PartnerPayoutRequestInput{PartnerActorID: other, ScopeMode: PartnerPayoutScopeFullAvailable, RequestedStoreIDs: []string{b}, BeneficiaryFacts: map[string]IdentityFacts{other: otherFacts}, IdempotencyKey: "gap-rejected-" + two.suffix, CorrelationID: "gap-rejected-corr-" + two.suffix}); !errors.Is(err, ErrPartnerPayoutAttributionGap) {
		t.Fatalf("ambiguous history accepted new payout: %v", err)
	}
}
