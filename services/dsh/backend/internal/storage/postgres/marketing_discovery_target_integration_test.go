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

func TestPromotionBannerDisappearsWhenPromotionCannotBeRedeemed(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, migrations []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, migrations, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const city, promo, banner = "banner-guard-city", "banner-guard-promotion", "banner-guard-content"
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'مدينة اختبار',true)", city); err != nil {
			t.Fatal(err)
		}
		createPublishedPromotion(t, ctx, db, promo, "BANNERGUARD", "", city, time.Now().UTC().Add(-time.Hour))
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets(
            id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
            state,creator,source_description,rights_statement,rights_attested_by_actor_id
        ) VALUES('banner-guard-media','banner-guard-idem',$2,'fixture/banner','asset://banner', $1,
        'image/jpeg',128,'active','Fixture Owner','Isolated promotion banner','Integration testing rights','fixture-operator')`, strings.Repeat("a", 64), postgres.HashMarketingFacts("banner-guard-hash")); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
            id,kind,title_ar,media_asset_id,target_type,target_id,service_city_id,state,starts_at,created_by_actor_id
        ) VALUES($1,'BANNER','بنر عرض تجريبي','banner-guard-media','PROMOTION',$2,$3,'PUBLISHED',clock_timestamp()-interval '1 minute','fixture-operator')`, banner, promo, city); err != nil {
			t.Fatal(err)
		}
		assertVisible := func(visible bool, reason string) {
			t.Helper()
			content, err := postgres.ListDiscoveryContent(ctx, db, true, city)
			if err != nil {
				t.Fatal(err)
			}
			if hasDiscoveryContent(content, banner) != visible {
				t.Fatalf("%s: public banner visible=%v, want %v", reason, hasDiscoveryContent(content, banner), visible)
			}
			_, err = postgres.ResolveDiscoveryContentTarget(ctx, db, banner, city)
			if visible && err != nil {
				t.Fatalf("%s: eligible destination rejected: %v", reason, err)
			}
			if !visible && !errors.Is(err, postgres.ErrDiscoveryContentNotFound) {
				t.Fatalf("%s: unsafe destination resolved: %v", reason, err)
			}
			promotions, err := postgres.ListPromotions(ctx, db, true, city, "")
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, p := range promotions {
				found = found || p.ID == promo
			}
			if found != visible {
				t.Fatalf("%s: public promotion visible=%v, want %v", reason, found, visible)
			}
			counts, err := postgres.CountPublicPromotionsForStores(ctx, db, city, []string{"fixture-store"})
			if err != nil {
				t.Fatal(err)
			}
			if (counts["fixture-store"] > 0) != visible {
				t.Fatalf("%s: promotion badge count=%d, want visible=%v", reason, counts["fixture-store"], visible)
			}
		}
		assertVisible(true, "active platform promotion")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET redemption_limit=1,redeemed_count=1 WHERE id=$1", promo); err != nil {
			t.Fatal(err)
		}
		assertVisible(false, "redemption limit reached")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET redemption_limit=NULL,redeemed_count=0,discount_budget_limit_minor=100,discount_spent_minor=100 WHERE id=$1", promo); err != nil {
			t.Fatal(err)
		}
		assertVisible(false, "discount budget exhausted")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET discount_budget_limit_minor=NULL,discount_spent_minor=0,funding_source='PARTNER',requires_partner_opt_in=true WHERE id=$1", promo); err != nil {
			t.Fatal(err)
		}
		assertVisible(false, "unconsented partner-funded city campaign")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET funding_source='BTHWANI',requires_partner_opt_in=true WHERE id=$1", promo); err != nil {
			t.Fatal(err)
		}
		assertVisible(false, "campaign requiring explicit opt-in")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET requires_partner_opt_in=false WHERE id=$1", promo); err != nil {
			t.Fatal(err)
		}
		assertVisible(true, "restored eligible campaign")
	})
}
