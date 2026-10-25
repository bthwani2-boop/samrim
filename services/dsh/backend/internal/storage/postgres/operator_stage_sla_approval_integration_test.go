package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestStageSLAPolicyApprovalVersionConflictAndReplay(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		empty, err := postgres.ReadOperatorStageSLAPolicies(ctx, db)
		if err != nil || len(empty) != 0 {
			t.Fatalf("silent default SLA: %+v err=%v", empty, err)
		}
		input := postgres.StageSLAPolicyInput{FulfillmentMode: "BTHWANI_CAPTAIN", Stage: "PREPARING", TargetMinutes: 45, WarningMinutes: 10, ExpectedVersion: 0}
		first, replay, err := postgres.CreateOperatorStageSLAPolicy(ctx, db, input, "approved_ops", "policy-first-001", "policy-corr-001")
		if err != nil || replay || first.Version != 1 {
			t.Fatalf("first %+v %v %v", first, replay, err)
		}
		again, replay, err := postgres.CreateOperatorStageSLAPolicy(ctx, db, input, "approved_ops", "policy-first-001", "policy-corr-001")
		if err != nil || !replay || again.Version != first.Version {
			t.Fatalf("replay %+v %v %v", again, replay, err)
		}
		changed := input
		changed.TargetMinutes = 15
		if _, _, err := postgres.CreateOperatorStageSLAPolicy(ctx, db, changed, "approved_ops", "policy-first-001", "policy-corr-001"); !errors.Is(err, postgres.ErrStageSLAPolicyConflict) {
			t.Fatalf("changed replay accepted: %v", err)
		}
		if _, _, err := postgres.CreateOperatorStageSLAPolicy(ctx, db, input, "approved_ops", "policy-stale-001", "policy-corr-002"); !errors.Is(err, postgres.ErrStageSLAPolicyConflict) {
			t.Fatalf("stale version accepted: %v", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.operator_stage_sla_policies SET target_minutes=1 WHERE policy_version=1"); err == nil {
			t.Fatal("retroactive edit accepted")
		}
		next := input
		next.TargetMinutes = 55
		next.ExpectedVersion = 1
		var wg sync.WaitGroup
		results := make(chan error, 2)
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()
				key := "parallel-sla-001"
				if index == 1 {
					key = "parallel-sla-002"
				}
				_, _, err := postgres.CreateOperatorStageSLAPolicy(ctx, db, next, "approved_ops", key, "parallel-corr-001")
				results <- err
			}(i)
		}
		wg.Wait()
		close(results)
		good, conflicts := 0, 0
		for err := range results {
			if err == nil {
				good++
			} else if errors.Is(err, postgres.ErrStageSLAPolicyConflict) {
				conflicts++
			} else {
				t.Fatalf("unexpected concurrent approval: %v", err)
			}
		}
		if good != 1 || conflicts != 1 {
			t.Fatalf("concurrent changes good=%d conflict=%d", good, conflicts)
		}
		policies, err := postgres.ReadOperatorStageSLAPolicies(ctx, db)
		if err != nil || len(policies) != 1 || policies[0].Version != 2 || policies[0].TargetMinutes != 55 {
			t.Fatalf("bad approval readback %+v err=%v", policies, err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.operator_stage_sla_policies").Scan(&count); err != nil || count != 2 {
			t.Fatalf("bad persisted approvals %d err=%v", count, err)
		}
	})
}
