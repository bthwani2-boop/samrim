package postgres

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
)

func TestStoreCommercialAgreementV39UpgradePreservesFinanceDecisionFacts(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_MIGRATION_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WLT_MIGRATION_TEST_DATABASE_URL is not configured")
	}
	if _, err := opsafety.RequireOrdinaryCLIEnvironment(os.Getenv("BTHWANI_ENV"), "WLT Store agreement migration integration test"); err != nil {
		t.Fatalf("refuse unsafe WLT test environment: %v", err)
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatalf("refuse non-dedicated WLT migration database: %v", err)
	}
	db, err := Open(databaseURL)
	if err != nil {
		t.Fatalf("open isolated WLT migration database: %v", err)
	}
	db.SetMaxOpenConns(4)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close isolated WLT migration database: %v", err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("connect isolated WLT migration database: %v", err)
	}
	var pristine bool
	if err := db.QueryRowContext(ctx, `SELECT to_regclass('wlt.schema_migrations') IS NULL AND to_regclass('wlt.payment_intents') IS NULL`).Scan(&pristine); err != nil {
		t.Fatalf("inspect isolated WLT migration database: %v", err)
	}
	if !pristine {
		t.Fatal("WLT migration database must be empty; refusing to rewrite existing schema history")
	}
	directory := filepath.Clean(filepath.Join("..", "..", "..", "..", "database", "migrations"))
	records, statements, err := LoadMigrations(directory)
	if err != nil {
		t.Fatalf("load canonical WLT migrations: %v", err)
	}
	if err := applyWLTMigrationPrefix(ctx, db, records, statements, 39); err != nil {
		t.Fatalf("prepare canonical WLT v39 database: %v", err)
	}
	fixtureID := fmt.Sprintf("agreement-migration-%d", time.Now().UTC().UnixNano())
	acceptedAt := time.Date(2026, time.October, 3, 12, 0, 0, 0, time.UTC)
	approvedAt := acceptedAt.Add(time.Minute)
	decisionAt := approvedAt.Add(time.Second)
	for _, item := range []struct {
		id, status, store, approvedBy, decisionReason, eventType, eventActor, eventReason string
		version                                                                           int
		acceptedAt, approvedAt, effectiveAt, supersededAt                                 any
	}{
		{id: fixtureID + "-active", status: "ACTIVE", store: fixtureID + "-active-store", approvedBy: "finance-active", decisionReason: "active decision reason", eventType: "FINANCE_APPROVED", eventActor: "finance-active", eventReason: "active decision reason", version: 1, acceptedAt: acceptedAt, approvedAt: approvedAt, effectiveAt: decisionAt},
		{id: fixtureID + "-superseded", status: "SUPERSEDED", store: fixtureID + "-superseded-store", approvedBy: "finance-superseded", decisionReason: "superseded decision reason", eventType: "FINANCE_APPROVED", eventActor: "finance-superseded", eventReason: "superseded decision reason", version: 1, acceptedAt: acceptedAt, approvedAt: approvedAt, effectiveAt: decisionAt, supersededAt: decisionAt.Add(time.Minute)},
		{id: fixtureID + "-rejected", status: "FINANCE_REJECTED", store: fixtureID + "-rejected-store", eventType: "FINANCE_REJECTED", eventActor: "finance-rejected", eventReason: "rejected decision reason", version: 1, acceptedAt: acceptedAt},
	} {
		idempotency := "migration-key-" + item.id
		requestHash := strings.Repeat("a", 64)
		if _, err := db.ExecContext(ctx, `INSERT INTO wlt.store_commercial_agreements(
			agreement_id,store_id,partner_actor_id,agreement_version,status,proposed_by_actor_id,proposed_at,
			partner_accepted_by_actor_id,partner_accepted_at,finance_approved_by_actor_id,finance_approved_at,effective_at,superseded_at,
			reason,finance_decision_reason,idempotency_key,request_hash,correlation_id
		) VALUES($1,$2,'migration-partner', $3,$4,'migration-field',$5,'migration-partner',$6,$7,$8,$9,$10,'proposal reason',NULLIF($11,''),$12,$13,$14)`,
			item.id, item.store, item.version, item.status, acceptedAt.Add(-time.Minute), item.acceptedAt, nullableString(item.approvedBy), item.approvedAt, item.effectiveAt, item.supersededAt,
			item.decisionReason, idempotency, requestHash, "migration-correlation-"+item.id); err != nil {
			t.Fatalf("seed v39 %s agreement: %v", item.status, err)
		}
		if item.status == "SUPERSEDED" {
			if _, err := db.ExecContext(ctx, `INSERT INTO wlt.store_commercial_agreement_events(id,agreement_id,event_type,from_status,to_status,actor_id,reason,idempotency_key,request_hash,correlation_id)
				VALUES($1,$2,'SUPERSEDED','ACTIVE','SUPERSEDED',$3,'superseded reason',$4,$5,$6)`, "supersede-event-"+item.id, item.id, "finance-successor", "supersede-key-"+item.id, strings.Repeat("b", 64), "supersede-correlation-"+item.id); err != nil {
				t.Fatalf("seed v39 supersede event: %v", err)
			}
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO wlt.store_commercial_agreement_events(id,agreement_id,event_type,from_status,to_status,actor_id,reason,idempotency_key,request_hash,correlation_id)
			VALUES($1,$2,$3,'PARTNER_ACCEPTED',$4,$5,$6,$7,$8,$9)`, "finance-event-"+item.id, item.id, item.eventType, map[string]string{"FINANCE_APPROVED": "ACTIVE", "FINANCE_REJECTED": "FINANCE_REJECTED"}[item.eventType], item.eventActor, item.eventReason, "finance-event-key-"+item.id, strings.Repeat("c", 64), "finance-event-correlation-"+item.id); err != nil {
			t.Fatalf("seed v39 Finance event: %v", err)
		}
	}
	if err := Migrate(ctx, db, records, statements); err != nil {
		t.Fatalf("upgrade WLT schema from v39 to v40: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatalf("verify canonical WLT v40 schema: %v", err)
	}
	for _, want := range []struct {
		id, actor, reason, status string
	}{
		{id: fixtureID + "-active", actor: "finance-active", reason: "active decision reason", status: "ACTIVE"},
		{id: fixtureID + "-superseded", actor: "finance-superseded", reason: "superseded decision reason", status: "SUPERSEDED"},
		{id: fixtureID + "-rejected", actor: "finance-rejected", reason: "rejected decision reason", status: "FINANCE_REJECTED"},
	} {
		var actor, reason, status string
		var decidedAt time.Time
		if err := db.QueryRowContext(ctx, `SELECT finance_decision_by_actor_id,finance_decision_at,finance_decision_reason,status
			FROM wlt.store_commercial_agreements WHERE agreement_id=$1`, want.id).Scan(&actor, &decidedAt, &reason, &status); err != nil {
			t.Fatalf("read back migrated Finance decision %s: %v", want.status, err)
		}
		if actor != want.actor || reason != want.reason || status != want.status || decidedAt.IsZero() {
			t.Fatalf("migrated Finance decision %s = actor:%q at:%s reason:%q status:%q; want actor:%q reason:%q status:%q", want.id, actor, decidedAt, reason, status, want.actor, want.reason, want.status)
		}
	}
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
