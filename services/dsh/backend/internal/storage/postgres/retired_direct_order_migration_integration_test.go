package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/lib/pq"
)

func TestRetiredDirectOrderUpgradePreservesDurableData(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_JOINING_QA_DATABASE_URL"))
	if dsn == "" {
		t.Skip("dedicated DSH QA database required")
	}
	if !joiningQADatabaseIsolated(dsn, os.Getenv) {
		t.Fatal("non-isolated target forbidden")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		const baseline = 174
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx, `CREATE SCHEMA dsh;
			CREATE TABLE dsh.schema_migrations (
				version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL,
				applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
			)`); err != nil {
			t.Fatal(err)
		}
		for index, record := range records[:baseline] {
			if _, err := tx.ExecContext(ctx, migrations[index]); err != nil {
				t.Fatalf("bootstrap v%d: %v", record.Version, err)
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version,name,sha256) VALUES($1,$2,$3)",
				record.Version, record.Name, record.SHA256); err != nil {
				t.Fatalf("record v%d: %v", record.Version, err)
			}
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}

		const storeID, owner, orderID = "qa-retained-store", "qa-retained-owner", "qa-retained-direct-order"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: owner, Name: "QA Retained Store"})
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE',
			fulfillment_modes=ARRAY['CUSTOMER_PICKUP'] WHERE id=$1`, storeID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.independent_direct_orders(
			id,store_id,publication_version,store_version,fulfillment_mode,guest_name,guest_phone_e164,
			hosting_terms_version,merchant_policy_version,merchant_policy_snapshot,subtotal_amount_minor,
			total_amount_minor,guest_capability_hash,guest_capability_expires_at)
			VALUES($1,$2,1,1,'CUSTOMER_PICKUP','Synthetic QA Guest','+967700000018','qa-host','qa-merchant',
				'{"cancellationTerms":"qa","returnsTerms":"qa","fulfillmentTerms":"qa","collectionTerms":"qa"}',
				500,500,repeat('a',64),clock_timestamp()+interval '1 hour')`, orderID, storeID); err != nil {
			t.Fatalf("seed task-owned historical Order: %v", err)
		}

		keys := testDeliveryProofKeyring(t)
		err = postgres.Migrate(ctx, db, records, migrations, keys)
		var pgErr *pq.Error
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" ||
			!strings.Contains(pgErr.Message, "cannot retire independent direct order storage containing records") {
			t.Fatalf("v176 must refuse a historical direct Order: %v", err)
		}
		var version int
		var replayTableCreated bool
		if err := db.QueryRowContext(ctx, `SELECT MAX(version), to_regclass('dsh.first_store_create_idempotency') IS NOT NULL
			FROM dsh.schema_migrations`).Scan(&version, &replayTableCreated); err != nil || version != baseline || replayTableCreated {
			t.Fatalf("failed upgrade must roll back to v174: version=%d replayTable=%t err=%v", version, replayTableCreated, err)
		}
		var orderStore string
		var amount int64
		if err := db.QueryRowContext(ctx, "SELECT store_id,total_amount_minor FROM dsh.independent_direct_orders WHERE id=$1", orderID).
			Scan(&orderStore, &amount); err != nil || orderStore != storeID || amount != 500 {
			t.Fatalf("failed upgrade must preserve the historical Order: store=%s amount=%d err=%v", orderStore, amount, err)
		}

		// The sole synthetic Order is removed from this test-owned child only.
		if _, err := db.ExecContext(ctx, "DELETE FROM dsh.independent_direct_orders WHERE id=$1 AND store_id=$2", orderID, storeID); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Migrate(ctx, db, records, migrations, keys); err != nil {
			t.Fatalf("upgrade empty retired storage from v174: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify canonical schema after v176: %v", err)
		}
		store, err := postgres.ReadStoreOwnedByPartner(ctx, db, storeID, owner)
		if err != nil || store.RelationModel != postgres.StoreRelationIndependent || store.Name != "QA Retained Store" {
			t.Fatalf("upgrade must preserve the canonical Store: %+v err=%v", store, err)
		}
	}, 5*time.Minute)
}
