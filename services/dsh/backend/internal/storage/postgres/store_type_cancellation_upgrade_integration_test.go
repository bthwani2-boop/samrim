package postgres_test

import (
	"context"
	"database/sql"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"os"
	"strings"
	"testing"
	"time"
)

func TestCancellationPolicyUpgradeFromV134PreservesOrders(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("disposable test database required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback() }()
		if _, err = tx.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.ExecContext(ctx, "CREATE TABLE dsh.schema_migrations (version integer PRIMARY KEY,name text NOT NULL,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())"); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 134; i++ {
			if _, err = tx.ExecContext(ctx, sqls[i]); err != nil {
				t.Fatalf("baseline %d: %v", i+1, err)
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version,name,sha256) VALUES($1,$2,$3)", records[i].Version, records[i].Name, records[i].SHA256); err != nil {
				t.Fatal(err)
			}
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		for _, query := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('upgrade-city','Test City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('upgrade-vertical','Test Vertical','Test Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('upgrade-type','upgrade-vertical','محل خضروات وفواكه','Greengrocer')",
			"INSERT INTO dsh.stores(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,publication_state,fulfillment_modes) VALUES('upgrade-store','upgrade-partner','Test Store','upgrade-city','upgrade-vertical','upgrade-type','unpublished',ARRAY['CUSTOMER_PICKUP'])",
			"INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('upgrade-cart','upgrade-client','upgrade-store','checked_out',1)",
			"INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,service_city_id,serviceability_store_version,state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor) VALUES('upgrade-order','upgrade-client','upgrade-store','upgrade-cart','upgrade-city',1,'CREATED',1500,'YER',1,'upgrade-payment','CASH_AT_STORE','REQUIRES_COLLECTION','CUSTOMER_PICKUP',300)",
		} {
			if _, err = db.ExecContext(ctx, query); err != nil {
				t.Fatal(err)
			}
		}
		if err = postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err = postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		order, err := postgres.ReadOrder(ctx, db, "upgrade-order")
		if err != nil || order.CancellationMode != "OPERATIONS_ONLY" || order.CancellationPolicyVersion != 0 ||
			order.State != "CREATED" || order.ClientActorID != "upgrade-client" || order.PaymentState != "REQUIRES_COLLECTION" {
			t.Fatalf("historical Order altered: %+v %v", order, err)
		}
		kind, err := postgres.ReadCommercialStoreType(ctx, db, "upgrade-type")
		if err != nil || kind.CancellationMode != "CLIENT_BEFORE_ACCEPTANCE" {
			t.Fatalf("historical Store Type lost: %+v %v", kind, err)
		}
		if _, _, err = postgres.UpdateStoreTypeCancellationMode(ctx, db, "upgrade-type",
			"OPERATIONS_ONLY", "Switch this type to reviewed cancellations", "upgrade-operator",
			"upgrade-policy-change-key", "upgrade-policy-correlation", 2); err != nil {
			t.Fatal(err)
		}
		order, err = postgres.ReadOrder(ctx, db, "upgrade-order")
		if err != nil || order.CancellationMode != "OPERATIONS_ONLY" {
			t.Fatalf("retroactive policy applied: %+v %v", order, err)
		}
	}, 3*time.Minute)
}
