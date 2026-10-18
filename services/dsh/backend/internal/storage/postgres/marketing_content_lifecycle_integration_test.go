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

// The complete content lifecycle is isolated from live DSH data. It proves
// persistent writer/readback, public eligibility, safe retry, and rollback.
func TestDiscoveryContentCreatePublishPauseResumeAndRetire(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL required for isolated lifecycle proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		const city = "lifecycle-city"
		const contentID = "lifecycle-content"
		const assetID = "lifecycle-asset"
		const idempotency = "lifecycle-create-unique"
		requestHash := postgres.HashMarketingFacts("create-lifecycle", contentID)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES($1,'Test City',true)", city); err != nil {
			t.Fatal(err)
		}

		asset, replayed, err := postgres.RegisterDiscoveryContentMediaAssetPending(ctx, db, postgres.DiscoveryContentMediaAssetInput{
			ID: assetID, IdempotencyKey: idempotency, RequestHash: requestHash,
			ObjectKey: "fixture/lifecycle", URI: "asset://lifecycle", ContentSHA256: strings.Repeat("a", 64),
			ContentType: "image/png", ByteSize: 128, Creator: "Fixture Owner",
			SourceDescription: "Isolated test-owned image", RightsStatement: "Permission granted for test",
			RightsAttestedBy: "fixture-operator",
		})
		if err != nil || replayed || asset.State != "pending" {
			t.Fatalf("register media: %+v replay=%v err=%v", asset, replayed, err)
		}
		input := postgres.DiscoveryContentInput{
			ID: contentID, Kind: "BANNER", TitleAr: "اختبار دورة نشر البنر",
			MediaAssetID: assetID, TargetType: "INFO", ServiceCityID: city,
			StartsAt: time.Now().UTC().Add(-time.Minute), Ordinal: 0, CreatedByActorID: "fixture-operator",
		}
		created, replayed, err := postgres.CreateDiscoveryContent(ctx, db, input, idempotency, requestHash)
		if err != nil || replayed || created.ID != contentID || created.State != "DRAFT" || created.Version != 1 || created.MediaURI == "" {
			t.Fatalf("create/readback: %+v replay=%v err=%v", created, replayed, err)
		}
		repeat, replayed, err := postgres.CreateDiscoveryContent(ctx, db, input, idempotency, requestHash)
		if err != nil || !replayed || repeat.ID != contentID || repeat.Version != 1 {
			t.Fatalf("idempotent create: %+v replay=%v err=%v", repeat, replayed, err)
		}
		if _, _, err := postgres.CreateDiscoveryContent(ctx, db, input, idempotency, postgres.HashMarketingFacts("different-input")); !errors.Is(err, postgres.ErrDiscoveryContentIdempotency) {
			t.Fatalf("conflicting retry should fail: %v", err)
		}
		assertPublic := func(want bool, why string) {
			t.Helper()
			list, err := postgres.ListDiscoveryContent(ctx, db, true, city)
			if err != nil {
				t.Fatal(err)
			}
			if hasDiscoveryContent(list, contentID) != want {
				t.Fatalf("%s: public listing mismatch, visible=%v, want=%v", why, hasDiscoveryContent(list, contentID), want)
			}
			_, err = postgres.ResolveDiscoveryContentTarget(ctx, db, contentID, city)
			if want && err != nil {
				t.Fatalf("%s: target should resolve: %v", why, err)
			}
			if !want && !errors.Is(err, postgres.ErrDiscoveryContentNotFound) {
				t.Fatalf("%s: invalid target still resolves: %v", why, err)
			}
		}
		assertPublic(false, "draft")
		publish, replayed, err := postgres.SetDiscoveryContentState(ctx, db, contentID, "PUBLISHED", "lifecycle-publish", postgres.HashMarketingFacts("lifecycle-publish"), created.Version)
		if err != nil || replayed || publish.State != "PUBLISHED" || publish.Version != 2 {
			t.Fatalf("publish: %+v replay=%v err=%v", publish, replayed, err)
		}
		assertPublic(true, "published")
		_, _, err = postgres.SetDiscoveryContentState(ctx, db, contentID, "PAUSED", "stale-pause", postgres.HashMarketingFacts("stale-pause"), 1)
		if !errors.Is(err, postgres.ErrDiscoveryContentVersion) {
			t.Fatalf("stale write accepted: %v", err)
		}
		pause, replayed, err := postgres.SetDiscoveryContentState(ctx, db, contentID, "PAUSED", "lifecycle-pause", postgres.HashMarketingFacts("lifecycle-pause"), 2)
		if err != nil || replayed || pause.State != "PAUSED" || pause.Version != 3 {
			t.Fatalf("pause: %+v replay=%v err=%v", pause, replayed, err)
		}
		assertPublic(false, "paused")
		repeatPause, replayed, err := postgres.SetDiscoveryContentState(ctx, db, contentID, "PAUSED", "lifecycle-pause", postgres.HashMarketingFacts("lifecycle-pause"), 2)
		if err != nil || !replayed || repeatPause.Version != 3 {
			t.Fatalf("pause retry: %+v replay=%v err=%v", repeatPause, replayed, err)
		}
		persisted, err := postgres.ReadDiscoveryContent(ctx, db, contentID)
		if err != nil || persisted.State != "PAUSED" || persisted.Version != 3 {
			t.Fatalf("operator readback: %+v err=%v", persisted, err)
		}
		resume, replayed, err := postgres.SetDiscoveryContentState(ctx, db, contentID, "PUBLISHED", "lifecycle-resume", postgres.HashMarketingFacts("lifecycle-resume"), 3)
		if err != nil || replayed || resume.State != "PUBLISHED" || resume.Version != 4 {
			t.Fatalf("resume: %+v replay=%v err=%v", resume, replayed, err)
		}
		assertPublic(true, "resumed")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", contentID); err != nil {
			t.Fatal(err)
		}
		assertPublic(false, "expired")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content SET ends_at=NULL WHERE id=$1", contentID); err != nil {
			t.Fatal(err)
		}
		assertPublic(true, "renewed after expiry")
		if _, err := db.ExecContext(ctx, "UPDATE dsh.discovery_content_media_assets SET state='retired',retired_at=clock_timestamp() WHERE id=$1", assetID); err != nil {
			t.Fatal(err)
		}
		assertPublic(false, "media retired")
		retained, err := postgres.ReadDiscoveryContent(ctx, db, contentID)
		if err != nil || retained.ID != contentID || retained.MediaURI != "" {
			t.Fatalf("retired content must preserve audit record without image: %+v err=%v", retained, err)
		}
	})
}
