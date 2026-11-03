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
	_ "github.com/lib/pq"
)

// This test creates and removes its own database through withFreshDatabase.
// It never writes to an existing Store, account, order, media object or ledger.
func TestPartnerStoreBannersFreshDatabaseScopePublicationAndReplay(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("DSH_DATABASE_URL must point to an isolated disposable PostgreSQL instance")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sources []string) {
		if err := postgres.Migrate(ctx, db, records, sources, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("fresh migration v171: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("fresh v171 schema verification: %v", err)
		}
		const city = "banner-proof-city"
		const otherCity = "banner-proof-other-city"
		const storeA = "banner-proof-store-a"
		const storeB = "banner-proof-store-b"
		for _, id := range []string{city, otherCity} {
			if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,$2,true)", id, "مدينة "+id); err != nil {
				t.Fatal(err)
			}
		}
		for _, store := range []string{storeA, storeB} {
			actor := "banner-actor-" + store
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: store, PartnerActorID: actor, Name: "Isolated Banner Store", ServiceCityID: city, PublicationState: "published"})
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_products(id,canonical_name,scope,vertical_id,store_id)
    VALUES($1,'منتج اختبار','STORE_SCOPED',$2,$3)`, store+"-product", store+"-vertical", store); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_product_variants(id,product_id,title,measurement_kind,base_unit)
    VALUES($1,$2,'قطعة','DISCRETE','COUNT')`, store+"-variant", store+"-product"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_store_offers(id,store_id,variant_id,price_minor,quantity_policy,pricing_basis,
     pricing_unit_base_units,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,inventory_policy,
     publication_state,availability)
     VALUES($1,$2,$3,1000,'DISCRETE','PER_UNIT',1,1,10,1,'AVAILABILITY_ONLY','published',true)`,
				store+"-offer", store, store+"-variant"); err != nil {
				t.Fatal(err)
			}
		}
		var visible int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM dsh.catalog_customer_visible_offers WHERE offer_id IN ($1,$2)`, storeA+"-offer", storeB+"-offer").Scan(&visible); err != nil || visible != 2 {
			t.Fatalf("Store targets must be visible before marketing proof: visible=%d err=%v", visible, err)
		}

		type banner struct {
			id, store, target, kind, state, mime string
			enabled                              bool
			startOffset, endOffset               string
		}
		cases := []banner{
			{"banner-visible-a", storeA, storeA, "BANNER", "PUBLISHED", "image/png", true, "-1h", "+24h"},
			{"banner-visible-b", storeB, storeB, "BANNER", "PUBLISHED", "image/jpeg", true, "-1h", "+24h"},
			{"banner-disabled-a", storeA, storeA, "BANNER", "PUBLISHED", "image/png", false, "-1h", "+24h"},
			{"banner-draft-a", storeA, storeA, "BANNER", "DRAFT", "image/png", true, "-1h", "+24h"},
			{"banner-paused-a", storeA, storeA, "BANNER", "PAUSED", "image/png", true, "-1h", "+24h"},
			{"banner-future-a", storeA, storeA, "BANNER", "PUBLISHED", "image/png", true, "+2h", "+24h"},
			{"banner-expired-a", storeA, storeA, "BANNER", "PUBLISHED", "image/png", true, "-24h", "-1h"},
			{"banner-cross-target-a", storeA, storeB, "BANNER", "PUBLISHED", "image/png", true, "-1h", "+24h"},
			{"reel-visible-a", storeA, storeA, "SHORT_FORM", "PUBLISHED", "video/mp4", true, "-1h", "+24h"},
			{"banner-platform", "", storeA, "BANNER", "PUBLISHED", "image/png", true, "-1h", "+24h"},
		}
		for _, c := range cases {
			asset := c.id + "-asset"
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_media_assets(
    id,idempotency_key,request_hash,object_key,uri,content_sha256,content_type,byte_size,
    state,creator,source_description,rights_statement,rights_attested_by_actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,128,'active','Test Owner','Isolated fixture','Authorized test rights','fixture-actor')`,
				asset, asset+"-idem", postgres.HashMarketingFacts(asset), "fixture/"+asset, "asset://"+asset, strings.Repeat("a", 64), c.mime); err != nil {
				t.Fatalf("media %s: %v", c.id, err)
			}
			var start, end time.Time
			start, end = time.Now().Add(parseBannerTimeOffset(t, c.startOffset)), time.Now().Add(parseBannerTimeOffset(t, c.endOffset))
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content(
    id,kind,title_ar,media_asset_id,target_type,target_id,source_store_id,service_city_id,state,starts_at,ends_at,created_by_actor_id,partner_enabled)
    VALUES($1,$2,'بنر اختبار',$3,'STORE',$4,NULLIF($5,''),$6,$7,$8,$9,'fixture-actor',$10)`,
				c.id, c.kind, asset, c.target, c.store, city, c.state, start, end, c.enabled); err != nil {
				t.Fatalf("content %s: %v", c.id, err)
			}
		}
		assertPublic := func(storeID, cityID string, want ...string) {
			t.Helper()
			items, err := postgres.ListPublishedStoreBanners(ctx, db, storeID, cityID)
			if err != nil {
				t.Fatalf("public banners for %s / %s: %v", storeID, cityID, err)
			}
			found := make([]string, 0, len(items))
			for _, item := range items {
				found = append(found, item.ID)
			}
			if len(found) != len(want) {
				t.Fatalf("public banners for %s / %s: got %v want %v", storeID, cityID, found, want)
			}
			for i := range want {
				if found[i] != want[i] {
					t.Fatalf("public banners for %s / %s: got %v want %v", storeID, cityID, found, want)
				}
			}
		}
		for _, testCase := range []struct {
			store, actor string
			allowed      bool
		}{
			{storeA, "banner-actor-" + storeA, true},
			{storeB, "banner-actor-" + storeB, true},
			{storeA, "banner-actor-" + storeB, false},
			{storeB, "banner-actor-" + storeA, false},
			{storeA, "ungrafted-banner-actor", false},
		} {
			_, _, authorityError := postgres.AuthorizePartnerStoreAction(ctx, db, testCase.store, testCase.actor, "promotions")
			if testCase.allowed && authorityError != nil {
				t.Fatalf("Store owner promotions authority denied: store=%s actor=%s error=%v", testCase.store, testCase.actor, authorityError)
			}
			if !testCase.allowed && !errors.Is(authorityError, postgres.ErrStoreAccessForbidden) {
				t.Fatalf("foreign actor was allowed Store promotions: store=%s actor=%s error=%v", testCase.store, testCase.actor, authorityError)
			}
		}
		assertPublic(storeA, city, "banner-visible-a")
		assertPublic(storeB, city, "banner-visible-b")
		assertPublic(storeA, otherCity)
		// Real, eligible Store-owned targets prove that an otherwise valid
		// foreign PRODUCT/PROMOTION can never be displayed in Store A's banner.
		for index, store := range []string{storeA, storeB} {
			code := []string{"BANPROOFA", "BANPROOFB"}[index]
			if _, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_promotions
			    (id,code,name_ar,kind,value_minor,starts_at,ends_at,created_by_actor_id,store_id,funding_source,state)
			    VALUES($1,$2,'عرض بنر تجريبي','FIXED',50,now()-interval '1 hour',now()+interval '1 day','banner-proof-actor',$3,'PARTNER','PUBLISHED')`,
				store+"-promo", code, store); err != nil {
				t.Fatalf("create Store-scoped promotion %s: %v", store, err)
			}
		}
		for _, target := range []struct{ kind, own, foreign string }{
			{"PRODUCT", storeA + "-product", storeB + "-product"},
			{"PROMOTION", storeA + "-promo", storeB + "-promo"},
		} {
			if _, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content SET target_type=$1,target_id=$2 WHERE id='banner-cross-target-a'", target.kind, target.own); err != nil {
				t.Fatal(err)
			}
			ownTargets, err := postgres.ListPublishedStoreBanners(ctx, db, storeA, city)
			if err != nil {
				t.Fatal(err)
			}
			ownVisible := false
			for _, item := range ownTargets {
				ownVisible = ownVisible || item.ID == "banner-cross-target-a"
			}
			if !ownVisible {
				t.Fatalf("valid own-Store %s banner missing", target.kind)
			}
			if _, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content SET target_id=$1 WHERE id='banner-cross-target-a'", target.foreign); err != nil {
				t.Fatal(err)
			}
			assertPublic(storeA, city, "banner-visible-a")
			if _, err := postgres.ResolveDiscoveryContentTarget(ctx, db, "banner-cross-target-a", city); !errors.Is(err, postgres.ErrDiscoveryContentNotFound) {
				t.Fatalf("foreign Store %s banner stayed navigable: %v", target.kind, err)
			}
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content SET target_type='STORE',target_id=$1 WHERE id='banner-cross-target-a'", storeB); err != nil {
			t.Fatal(err)
		}
		assertPublic(storeA+"' OR true --", city)
		assertPublic(storeA, city+"' OR true --")
		own, err := postgres.ListPartnerStoreBanners(ctx, db, storeA)
		if err != nil || len(own) != 7 {
			t.Fatalf("partner Store A list must include only its 7 drafts/approved: count=%d err=%v", len(own), err)
		}
		other, err := postgres.ListPartnerStoreBanners(ctx, db, storeB)
		if err != nil || len(other) != 1 || other[0].ID != "banner-visible-b" {
			t.Fatalf("partner Store B list leaked: %+v %v", other, err)
		}

		all, err := postgres.ListDiscoveryContent(ctx, db, true, city)
		if err != nil {
			t.Fatal(err)
		}
		var hasPlatform, hasReel, leakedPartnerBanner bool
		for _, item := range all {
			hasPlatform = hasPlatform || item.ID == "banner-platform"
			hasReel = hasReel || item.ID == "reel-visible-a"
			leakedPartnerBanner = leakedPartnerBanner || (item.Kind == "BANNER" && item.SourceStoreID != "")
		}
		if !hasPlatform || !hasReel || leakedPartnerBanner {
			t.Fatalf("global discovery placement changed: platform=%v reel=%v merchant-banner-leak=%v", hasPlatform, hasReel, leakedPartnerBanner)
		}
		key := "banner-proof-hide-key"
		corr := "banner-proof-corr"
		for _, id := range []string{"banner-draft-a", "banner-paused-a"} {
			before, err := postgres.ReadDiscoveryContent(ctx, db, id)
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = postgres.SetPartnerStoreBannerEnabled(ctx, db, storeA, id, "actor-A", false,
				before.Version, key+"-unapproved-"+id, corr)
			if !errors.Is(err, postgres.ErrDiscoveryContentNotFound) {
				t.Fatalf("Partner changed an unapproved banner %s: %v", id, err)
			}
			after, err := postgres.ReadDiscoveryContent(ctx, db, id)
			if err != nil || after.Version != before.Version || after.PartnerEnabled != before.PartnerEnabled {
				t.Fatalf("rejected banner mutation changed persistent state %s: before=%+v after=%+v err=%v", id, before, after, err)
			}
		}
		click := postgres.DiscoveryContentEventInput{
			ID: "banner-click-proof", ClientEventID: "banner-click-proof",
			ContentID: "banner-visible-a", EventType: "CLICK", ClientSessionID: "banner-proof-session",
		}
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, click); err != nil {
			t.Fatalf("published Store banner must allow a click: %v", err)
		}
		if _, _, err = postgres.SetPartnerStoreBannerEnabled(ctx, db, storeB, "banner-visible-a", "actor-B", false, 1, key+"-foreign", corr); !errors.Is(err, postgres.ErrDiscoveryContentNotFound) {
			t.Fatalf("foreign Store could hide Store A banner: %v", err)
		}
		changed, replay, err := postgres.SetPartnerStoreBannerEnabled(ctx, db, storeA, "banner-visible-a", "actor-A", false, 1, key, corr)
		if err != nil || replay || changed.PartnerEnabled || changed.Version != 2 {
			t.Fatalf("disable result=%+v replay=%v err=%v", changed, replay, err)
		}
		assertPublic(storeA, city)
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, click); err != nil {
			t.Fatalf("exact click replay after hiding must remain idempotent: %v", err)
		}
		newClick := click
		newClick.ID, newClick.ClientEventID = "banner-new-click-proof", "banner-new-click-proof"
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, newClick); !errors.Is(err, postgres.ErrDiscoveryContentEventNotFound) {
			t.Fatalf("new click on Partner-disabled banner was accepted: %v", err)
		}
		if _, err := postgres.ResolveDiscoveryContentTarget(ctx, db, "banner-visible-a", city); !errors.Is(err, postgres.ErrDiscoveryContentNotFound) {
			t.Fatalf("hidden Partner banner remained navigable: %v", err)
		}
		changed, replay, err = postgres.SetPartnerStoreBannerEnabled(ctx, db, storeA, "banner-visible-a", "actor-A", false, 1, key, corr)
		if err != nil || !replay || changed.PartnerEnabled || changed.Version != 2 {
			t.Fatalf("idempotent replay result=%+v replay=%v err=%v", changed, replay, err)
		}
		if _, _, err = postgres.SetPartnerStoreBannerEnabled(ctx, db, storeA, "banner-visible-a", "actor-A", true, 1, key, corr); !errors.Is(err, postgres.ErrDiscoveryContentIdempotency) {
			t.Fatalf("different facts reused idempotency key: %v", err)
		}
		if _, _, err = postgres.SetPartnerStoreBannerEnabled(ctx, db, storeA, "banner-visible-a", "actor-A", true, 1, key+"-stale", corr); !errors.Is(err, postgres.ErrDiscoveryContentVersion) {
			t.Fatalf("stale version accepted: %v", err)
		}
		changed, replay, err = postgres.SetPartnerStoreBannerEnabled(ctx, db, storeA, "banner-visible-a", "actor-A", true, 2, key+"-restore", corr)
		if err != nil || replay || !changed.PartnerEnabled || changed.Version != 3 {
			t.Fatalf("restore result=%+v replay=%v err=%v", changed, replay, err)
		}
		assertPublic(storeA, city, "banner-visible-a")
		if err := postgres.RecordDiscoveryContentEvent(ctx, db, newClick); err != nil {
			t.Fatalf("restored Partner banner should accept new clicks again: %v", err)
		}
		// Independent keys racing the same expected version must yield exactly
		// one committed update and one conflict; neither may overwrite the other.
		type visibilityOutcome struct {
			item postgres.DiscoveryContentRecord
			err  error
		}
		var result [2]visibilityOutcome
		var wg sync.WaitGroup
		for index, enabled := range []bool{false, true} {
			wg.Add(1)
			go func(index int, enabled bool) {
				defer wg.Done()
				item, _, updateErr := postgres.SetPartnerStoreBannerEnabled(ctx, db, storeA,
					"banner-visible-a", "actor-A", enabled, 3, "banner-proof-race-key-"+string(rune('a'+index)), corr)
				result[index] = visibilityOutcome{item: item, err: updateErr}
			}(index, enabled)
		}
		wg.Wait()
		var committed, rejected int
		for _, got := range result {
			switch {
			case got.err == nil:
				committed++
				if got.item.Version != 4 {
					t.Fatalf("racing update did not commit version 4: %+v", got.item)
				}
			case errors.Is(got.err, postgres.ErrDiscoveryContentVersion):
				rejected++
			default:
				t.Fatalf("unexpected concurrent visibility result: %+v", got)
			}
		}
		if committed != 1 || rejected != 1 {
			t.Fatalf("race improperly serialized: committed=%d rejected=%d", committed, rejected)
		}
		final, err := postgres.ReadDiscoveryContent(ctx, db, "banner-visible-a")
		if err != nil || final.Version != 4 {
			t.Fatalf("race corrupts persisted version: %+v %v", final, err)
		}
		if final.PartnerEnabled {
			assertPublic(storeA, city, "banner-visible-a")
		} else {
			assertPublic(storeA, city)
		}
	}, 4*time.Minute)
}
func parseBannerTimeOffset(t *testing.T, s string) time.Duration {
	t.Helper()
	d, err := time.ParseDuration(strings.ReplaceAll(s, " ", ""))
	if err != nil {
		t.Fatal(err)
	}
	return d
}
