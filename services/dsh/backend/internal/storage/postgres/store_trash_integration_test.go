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
)

func TestStoreTrashPreservesRelationshipsAndNeverRepublishes(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	for i := 0; i < 20; i++ {
		err = root.PingContext(ctx)
		if err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, scripts []string) {
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "trash_store_test", PartnerActorID: "store_partner_test", Name: "متجر تراث صنعاء", PublicationState: "published"})

		// Active orders must not be orphaned by a store archive.
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('trash_city','مدينة الاختبار',true)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES('trash_order_cart','client_trash','trash_store_test','checked_out',1)"); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_cash_amount_minor,currency,version) VALUES('trash_store_order','client_trash','trash_store_test','trash_order_cart','trash_order_address',1,'عنوان تجريبي',15.36,44.19,'trash_city','CITY_SCOPE_V1','SERVICEABLE',1,1,'READY_FOR_DISPATCH',1800,1800,'YER',1)"); err != nil {
			t.Fatal(err)
		}
		if _, _, err := postgres.SetStoreTrashed(ctx, db, "trash_store_test", "operator-test", "إغلاق متجر للاختبار", "trash", "store-open-order-key-001", 1); !errors.Is(err, postgres.ErrStoreTrashOpenOrders) {
			t.Fatalf("active order archive was allowed: %v", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state='CANCELLED' WHERE id='trash_store_order'"); err != nil {
			t.Fatal(err)
		}
		_, _, err = postgres.SetStoreTrashed(ctx, db, "trash_store_test", "operator-test", "إغلاق متجر للاختبار", "trash", "store-archive-key-001", 9)
		if !errors.Is(err, postgres.ErrStoreTrashConflict) {
			t.Fatalf("stale version was accepted: %v", err)
		}
		item, replay, err := postgres.SetStoreTrashed(ctx, db, "trash_store_test", "operator-test", "إغلاق متجر للاختبار", "trash", "store-archive-key-002", 1)
		if err != nil || replay || item.DeletedAt == nil || item.Version != 2 || item.PartnerActorID != "store_partner_test" {
			t.Fatalf("archive: %+v replay=%v err=%v", item, replay, err)
		}
		same, replay, err := postgres.SetStoreTrashed(ctx, db, "trash_store_test", "operator-test", "إغلاق متجر للاختبار", "trash", "store-archive-key-002", 1)
		if err != nil || !replay || same.Version != 2 {
			t.Fatalf("idempotent archive: %+v replay=%v err=%v", same, replay, err)
		}
		page, err := postgres.ListDeletedStores(ctx, db, 25, "")
		if err != nil || len(page.Stores) != 1 || page.Stores[0].ID != "trash_store_test" {
			t.Fatalf("archive page: %+v %v", page, err)
		}
		active, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", "updated_desc", 25, "")
		if err != nil || len(active.Stores) != 0 {
			t.Fatalf("archived store leaked into operator active registry: %+v %v", active, err)
		}
		var publication string
		var count int
		if err := db.QueryRowContext(ctx, "SELECT publication_state FROM dsh.stores WHERE id=$1", item.ID).Scan(&publication); err != nil || publication != "hidden" {
			t.Fatalf("archived publication state: %q %v", publication, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET publication_state='published' WHERE id=$1", item.ID); err == nil {
			t.Fatal("archive allowed republishing via SQL bypass")
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.commerce_orders WHERE id='trash_store_order' AND store_id=$1 AND state='CANCELLED'", item.ID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("historical order lost when archiving Store: %d %v", count, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2", item.ID, "store_partner_test").Scan(&count); err != nil || count != 1 {
			t.Fatalf("canonical store relationship lost: count=%d err=%v", count, err)
		}
		if _, _, err := postgres.SetStoreTrashed(ctx, db, item.ID, "operator-test", "", "restore", "store-stale-restore-0001", 1); !errors.Is(err, postgres.ErrStoreTrashConflict) {
			t.Fatalf("stale restore accepted: %v", err)
		}
		restored, replay, err := postgres.SetStoreTrashed(ctx, db, item.ID, "operator-test", "", "restore", "store-restore-key-001", 2)
		if err != nil || replay || restored.Version != 3 || restored.DeletedAt != nil {
			t.Fatalf("restore: %+v %v %v", restored, replay, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT publication_state FROM dsh.stores WHERE id=$1", item.ID).Scan(&publication); err != nil || publication != "hidden" {
			t.Fatalf("restore republished automatically: %q %v", publication, err)
		}
		page, err = postgres.ListDeletedStores(ctx, db, 25, "")
		if err != nil || len(page.Stores) != 0 {
			t.Fatalf("restored store left in trash: %+v %v", page, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_trash_audit WHERE store_id=$1", item.ID).Scan(&count); err != nil || count != 2 {
			t.Fatalf("store audit missing: %d %v", count, err)
		}
	})
}
