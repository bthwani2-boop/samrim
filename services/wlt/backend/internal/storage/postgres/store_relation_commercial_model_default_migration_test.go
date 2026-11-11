package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
)

// This test runs alone against the disposable WLT finance-proof database. A
// fresh v62 bootstrap is not enough to prove preservation from an installed v61
// baseline, so this test constructs the exact historical migration ledger first.
func TestStoreRelationCommercialModelDefaultUpgradePreservesV61Agreements(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("verified isolated WLT_TEST_DATABASE_URL required")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatalf("refusing unsafe WLT database target: %v", err)
	}
	db, err := Open(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	records, sqls, err := LoadMigrations(filepath.Join("..", "..", "..", "..", "database", "migrations"))
	if err != nil || len(records) != SchemaVersion || len(sqls) != SchemaVersion {
		t.Fatalf("canonical WLT migration catalog unavailable: %v", err)
	}
	// This isolated test's database must be empty. Never downgrade or mutate
	// an existing installation, including another developer's finance proof.
	var existingSchema sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('wlt.schema_migrations')::text").Scan(&existingSchema); err != nil {
		t.Fatal(err)
	}
	if existingSchema.Valid {
		t.Fatal("refuse to migrate a pre-existing WLT database in the historical upgrade proof")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "CREATE SCHEMA wlt"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE wlt.schema_migrations (
		version integer PRIMARY KEY,
		name text NOT NULL,
		sha256 text NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
		t.Fatal(err)
	}
	for i, migration := range records[:61] {
		if _, err := tx.ExecContext(ctx, sqls[i]); err != nil {
			t.Fatalf("canonical historical WLT v%d migration failed: %v", migration.Version, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.schema_migrations(version,name,sha256)
			VALUES($1,$2,$3)`, migration.Version, migration.Name, migration.SHA256); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var beforeSchema sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('wlt.store_relation_commercial_model_defaults')::text").Scan(&beforeSchema); err != nil || beforeSchema.Valid {
		t.Fatalf("model policy v62 table must not exist at v61: value=%v err=%v", beforeSchema, err)
	}

	suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
	storeID := "v61-store-" + suffix
	partnerID := "v61-partner-" + suffix
	proposed, replayed, err := ProposeStoreCommercialAgreement(ctx, db, ProposeStoreCommercialAgreementInput{
		StoreID: storeID, PartnerActorID: partnerID,
		Rates:                  []StoreCommercialAgreementRate{{FulfillmentMode: "CUSTOMER_PICKUP", CommissionRateBps: 0}},
		ExpectedCurrentVersion: 0, ActorID: "v61-operator-" + suffix,
		Reason:         "Preserve original Store-specific commission terms",
		IdempotencyKey: "v61-policy-propose-" + suffix, CorrelationID: "v61-policy-correlation-" + suffix,
	})
	if err != nil || replayed || proposed.Status != "PROPOSED" {
		t.Fatalf("v61 real agreement writer failed: %+v replayed=%t err=%v", proposed, replayed, err)
	}
	beforeAgreements, err := ReadStoreCommercialAgreements(ctx, db, storeID)
	if err != nil || len(beforeAgreements) != 1 {
		t.Fatalf("v61 Store agreement readback invalid: count=%d err=%v", len(beforeAgreements), err)
	}
	var balanceEntriesBefore int64
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wlt.ledger_entries").Scan(&balanceEntriesBefore); err != nil {
		t.Fatal(err)
	}

	// The actual WLT migrator checks all previous migration hashes and only
	// applies v62. No SQL shortcut is allowed for the forward upgrade.
	if err := Migrate(ctx, db, records, sqls); err != nil {
		t.Fatalf("WLT v61->v62 upgrade failed: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatalf("post-upgrade canonical schema invalid: %v", err)
	}
	afterAgreements, err := ReadStoreCommercialAgreements(ctx, db, storeID)
	if err != nil || !reflect.DeepEqual(beforeAgreements, afterAgreements) {
		t.Fatalf("v61 Store-specific financial agreement mutated during upgrade: %v", err)
	}
	var balanceEntriesAfter int64
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wlt.ledger_entries").Scan(&balanceEntriesAfter); err != nil || balanceEntriesAfter != balanceEntriesBefore {
		t.Fatalf("v62 migration changed financial journal entries: before=%d after=%d err=%v", balanceEntriesBefore, balanceEntriesAfter, err)
	}

	updated, replayed, err := UpdateStoreRelationCommercialModelDefault(ctx, db, StoreRelationCommercialModelDefaultUpdate{
		RelationModel: "INDEPENDENT_STORE", CommercialModel: "SUBSCRIPTION", ExpectedVersion: 0,
		ActingActorID:  "v62-operator-" + suffix,
		Reason:         "Prospective independent Store subscription terms after safe upgrade",
		IdempotencyKey: "v62-relation-" + suffix, CorrelationID: "v62-relation-correlation-" + suffix,
	})
	if err != nil || replayed || updated.PolicyVersion != 1 || updated.CommercialModel != "SUBSCRIPTION" {
		t.Fatalf("post-upgrade new policy writer failed: %+v replayed=%t err=%v", updated, replayed, err)
	}
	afterPolicy, err := ReadStoreRelationCommercialModelDefaults(ctx, db)
	if err != nil || len(afterPolicy) != 1 || afterPolicy[0].RelationModel != "INDEPENDENT_STORE" {
		t.Fatalf("v62 policy canonical readback invalid: %+v err=%v", afterPolicy, err)
	}
	afterAgreements, err = ReadStoreCommercialAgreements(ctx, db, storeID)
	if err != nil || !reflect.DeepEqual(beforeAgreements, afterAgreements) {
		t.Fatalf("new model policy altered retained v61 Store agreement: %v", err)
	}
	if err := Migrate(ctx, db, records, sqls); err != nil {
		t.Fatalf("idempotent full WLT migration verification failed: %v", err)
	}
}
