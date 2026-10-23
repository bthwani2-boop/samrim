package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestMultiStoreDiscoveryAttributionRejectsForeignActor(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if url == "" {
		t.Skip("isolated PostgreSQL required")
	}
	root, err := sql.Open("postgres", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err = root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, url, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		city := "attribution-multi-city"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Sanaa',true)", city); err != nil {
			t.Fatal(err)
		}
		for _, store := range []string{"attribution-store-a", "attribution-store-b"} {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: "attribution-partner-" + store, Name: "Attribution " + store, ServiceCityID: city})
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets(
     id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
     state,creator,source_description,rights_statement,rights_attested_by_actor_id)
     VALUES('attr-asset','attr-asset-idem',$2,'attr/asset','asset://attr',
            $1,'image/png',128,'active','fixture','licensed','test rights','fixture')`, strings.Repeat("a", 64), postgres.HashMarketingFacts("attr-asset")); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
     id,kind,title_ar,media_asset_id,target_type,target_id,service_city_id,state,starts_at,created_by_actor_id)
     VALUES('attr-content','BANNER','Test','attr-asset','STORE','attribution-store-a',$1,
            'PUBLISHED',clock_timestamp()-interval '1 hour','fixture')`, city); err != nil {
			t.Fatal(err)
		}
		// Canonical ingest currently records anonymous clicks. This explicitly tests
		// a schema-supported actor-bound click, including imported historical data.
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_events
          (id,client_event_id,content_id,event_type,client_session_id,client_actor_id)
          VALUES('attribution-click','attribution-click','attr-content','CLICK',
                 'attribution-session-at-least-16','attribution-buyer-a')`); err != nil {
			t.Fatal(err)
		}
		children := []postgres.MultiStoreCheckoutChildInput{{StoreID: "attribution-store-a"}, {StoreID: "attribution-store-b"}}
		foreign, err := postgres.ResolveMultiStoreDiscoveryAttributionStore(ctx, db, "attribution-click", "attribution-buyer-b", children)
		if err != nil || foreign != "" {
			t.Fatalf("foreign click credited: %q %v", foreign, err)
		}
		own, err := postgres.ResolveMultiStoreDiscoveryAttributionStore(ctx, db, "attribution-click", "attribution-buyer-a", children)
		if err != nil || own != "attribution-store-a" {
			t.Fatalf("owner click not correctly resolved: %q %v", own, err)
		}
		unknown, err := postgres.ResolveMultiStoreDiscoveryAttributionStore(ctx, db, "invalid-click", "attribution-buyer-a", children)
		if err != nil || unknown != "" {
			t.Fatalf("missing click credited: %q %v", unknown, err)
		}
	})
}
