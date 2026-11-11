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
// fresh schema bootstrap is not enough to prove preservation from an installed v61
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
	if err != nil || len(records) == 0 || len(records) != len(sqls) {
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

	// The actual WLT migrator checks every v61 historical hash and applies
	// only pending forward versions (v62 and v63), never direct SQL shortcuts.
	if err := Migrate(ctx, db, records, sqls); err != nil {
		t.Fatalf("WLT v61->v63 upgrade failed: %v", err)
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
		t.Fatalf("forward migration changed financial journal entries: before=%d after=%d err=%v", balanceEntriesBefore, balanceEntriesAfter, err)
	}

	updated, replayed, err := UpdateStoreRelationCommercialModelDefault(ctx, db, StoreRelationCommercialModelDefaultUpdate{
		RelationModel: "INDEPENDENT_STORE", CommercialModel: "SUBSCRIPTION", ExpectedVersion: 0,
		ActingActorID:  "v63-operator-" + suffix,
		Reason:         "Prospective independent Store subscription terms after safe upgrade",
		IdempotencyKey: "v63-relation-" + suffix, CorrelationID: "v63-relation-correlation-" + suffix,
	})
	if err != nil || replayed || updated.PolicyVersion != 1 || updated.CommercialModel != "SUBSCRIPTION" {
		t.Fatalf("post-upgrade new policy writer failed: %+v replayed=%t err=%v", updated, replayed, err)
	}
	afterPolicy, err := ReadStoreRelationCommercialModelDefaults(ctx, db)
	if err != nil || len(afterPolicy) != 1 || afterPolicy[0].RelationModel != "INDEPENDENT_STORE" {
		t.Fatalf("v63 policy canonical readback invalid: %+v err=%v", afterPolicy, err)
	}
	afterAgreements, err = ReadStoreCommercialAgreements(ctx, db, storeID)
	if err != nil || !reflect.DeepEqual(beforeAgreements, afterAgreements) {
		t.Fatalf("new model policy altered retained v61 Store agreement: %v", err)
	}
	if err := Migrate(ctx, db, records, sqls); err != nil {
		t.Fatalf("idempotent full WLT migration verification failed: %v", err)
	}
}

// A v62 installation may already have accepted prospective model policies.
// Upgrade through the canonical migrator, without discarding their immutable
// event receipts or changing Store agreements and financial journal rows.
func TestStoreRelationCommercialModelDefaultEventV62UpgradePreservesHistory(t *testing.T) {
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
	if err != nil || len(records) < 63 || len(records) != len(sqls) {
		t.Fatalf("canonical WLT v63 migration manifest is unavailable: %v", err)
	}
	var existing sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('wlt.schema_migrations')::text").Scan(&existing); err != nil || existing.Valid {
		t.Fatalf("historical upgrade requires a fresh disposable database: prior=%v err=%v", existing, err)
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
		version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
		t.Fatal(err)
	}
	for i, record := range records[:62] {
		if _, err := tx.ExecContext(ctx, sqls[i]); err != nil {
			t.Fatalf("historical WLT v%d schema initialization failed: %v", record.Version, err)
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES($1,$2,$3)",
			record.Version, record.Name, record.SHA256); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
	input := StoreRelationCommercialModelDefaultUpdate{
		RelationModel: "INDEPENDENT_STORE", CommercialModel: "SUBSCRIPTION", ExpectedVersion: 0,
		ActingActorID:  "v62-policy-operator-" + suffix,
		Reason:         "Preserve prospective model default through forward SQL upgrade",
		IdempotencyKey: "v62-policy-upgrade-" + suffix,
		CorrelationID:  "v62-policy-correlation-" + suffix,
	}
	original, replayed, err := UpdateStoreRelationCommercialModelDefault(ctx, db, input)
	if err != nil || replayed || original.PolicyVersion != 1 {
		t.Fatalf("v62 owner-backed policy creation failed: %+v replayed=%t err=%v", original, replayed, err)
	}
	var hashBefore string
	var eventTimeBefore time.Time
	if err := db.QueryRowContext(ctx, `SELECT request_hash,changed_at FROM
		wlt.store_relation_commercial_model_default_events WHERE idempotency_key=$1`,
		input.IdempotencyKey).Scan(&hashBefore, &eventTimeBefore); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, db, records, sqls); err != nil {
		t.Fatalf("WLT v62-to-v63 forward migration failed: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatal(err)
	}
	after, replayed, err := UpdateStoreRelationCommercialModelDefault(ctx, db, input)
	if err != nil || !replayed || !reflect.DeepEqual(original, after) {
		t.Fatalf("v63 changed original persisted policy receipt: before=%+v after=%+v replayed=%t err=%v", original, after, replayed, err)
	}
	var hashAfter string
	var eventTimeAfter time.Time
	var eventCount int
	if err := db.QueryRowContext(ctx, `SELECT request_hash,changed_at FROM
		wlt.store_relation_commercial_model_default_events WHERE idempotency_key=$1`,
		input.IdempotencyKey).Scan(&hashAfter, &eventTimeAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM
		wlt.store_relation_commercial_model_default_events`).Scan(&eventCount); err != nil {
		t.Fatal(err)
	}
	if hashBefore != hashAfter || !eventTimeBefore.Equal(eventTimeAfter) || eventCount != 1 {
		t.Fatalf("v63 mutated immutable v62 policy audit: hashEqual=%t timeEqual=%t events=%d",
			hashBefore == hashAfter, eventTimeBefore.Equal(eventTimeAfter), eventCount)
	}
	if err := Migrate(ctx, db, records, sqls); err != nil {
		t.Fatalf("WLT exact v63 schema replay failed: %v", err)
	}
}
