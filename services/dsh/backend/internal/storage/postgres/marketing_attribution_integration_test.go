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
	_ "github.com/lib/pq"
)

// An order alone cannot be counted as marketing-attributed. This fixture is
// created only in a disposable database owned by withFreshDatabase.
func TestDiscoveryConversionRequiresPreOrderClickInSameSession(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated discovery attribution proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply migrations: %v", err)
		}
		const (
			city    = "attribution-test-city"
			store   = "attribution-test-store"
			cart    = "attribution-test-cart"
			order   = "attribution-test-order"
			content = "attribution-test-content"
			session = "session-1234567890"
			actor   = "attribution-test-client"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Test City',true)", city); err != nil {
			t.Fatalf("insert city: %v", err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: "attribution-test-partner", Name: "Test Store", ServiceCityID: city})
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets(
			id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
			state,creator,source_description,rights_statement,rights_attested_by_actor_id
		) VALUES('attribution-asset','attribution-idempotency',repeat('b',64),'fixture/attribution','asset://attribution', $1,
			'image/jpeg',128,'active','Test Creator','Owned test fixture','Licensed for test','marketing-operator')`, strings.Repeat("a", 64)); err != nil {
			t.Fatalf("insert media: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
			id,kind,title_ar,media_asset_id,target_type,service_city_id,state,starts_at,ordinal,created_by_actor_id
		) VALUES($1,'BANNER','إعلان تجريبي','attribution-asset','INFO',$2,'PUBLISHED',$3,0,'marketing-operator')`,
			content, city, time.Now().UTC().Add(-time.Hour)); err != nil {
			t.Fatalf("insert content: %v", err)
		}
		conversion := postgres.DiscoveryContentEventInput{
			ID: "conversion-1", ClientEventID: "client-conversion-1",
			ContentID: content, EventType: "CONVERSION", ClientSessionID: session,
			ClientActorID: actor, OrderID: order,
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'checked_out',1)", cart, actor, store); err != nil {
			t.Fatalf("insert cart: %v", err)
		}
		// Click must precede order creation. Creating an order without a
		// click is not by itself a marketing conversion.
		click := postgres.DiscoveryContentEventInput{
			ID: "click-1", ClientEventID: "client-click-1",
			ContentID: content, EventType: "CLICK", ClientSessionID: session,
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, click); err != nil {
			t.Fatalf("record click: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(
			id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,
			service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,
			state,total_amount_minor,currency,version,payment_intent_id,payment_method,payment_state,fulfillment_mode,payment_cash_amount_minor
		) VALUES($1,$2,$3,$4,'attribution-address',1,'Test address',15.36,44.19,$5,'CITY_SCOPE_V1','SERVICEABLE',1,1,
			'CREATED',1800,'YER',1,'attribution-payment','CASH_ON_DELIVERY','REQUIRES_COLLECTION','BTHWANI_CAPTAIN',1800)`,
			order, actor, store, cart, city); err != nil {
			t.Fatalf("insert order: %v", err)
		}
		wrongSession := conversion
		wrongSession.ID, wrongSession.ClientEventID, wrongSession.ClientSessionID = "bad-session", "bad-session-client", "session-0000000000"
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, wrongSession); !errors.Is(err, postgres.ErrDiscoveryContentEventInvalid) {
			t.Fatalf("order from unrelated session must not be attributed: %v", err)
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, conversion); err != nil {
			t.Fatalf("record click-attributed order: %v", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.discovery_content_events
			SET occurred_at=clock_timestamp()-interval '25 hours' WHERE client_event_id=$1`, click.ClientEventID); err != nil {
			t.Fatalf("age click: %v", err)
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, conversion); err != nil {
			t.Fatalf("exact replay must survive expired click: %v", err)
		}
		another := conversion
		another.ID, another.ClientEventID = "conversion-2", "client-conversion-2"
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, another); !errors.Is(err, postgres.ErrDiscoveryContentEventInvalid) {
			t.Fatalf("expired click must not authorize a new attributed event: %v", err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.discovery_content_events WHERE event_type='CONVERSION' AND order_id=$1", order).Scan(&count); err != nil || count != 1 {
			t.Fatalf("canonical conversion count=%d err=%v, expected exactly one", count, err)
		}
	})
}
