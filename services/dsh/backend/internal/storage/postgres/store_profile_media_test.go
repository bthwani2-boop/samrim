package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestStoreProfileMediaReplayAndCleanupOwnership(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh store-profile-media proof")
	}

	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify DSH schema: %v", err)
		}

		const (
			fieldActorID  = "act_field_media_cleanup"
			serviceCityID = "field-media-cleanup-city"
			verticalID    = "field-media-cleanup-food"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar) VALUES($1,$2)", serviceCityID, "مدينة الوسائط"); err != nil {
			t.Fatalf("insert Service City fixture: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,$2,$3)", verticalID, "مطاعم الوسائط", "Media Restaurants"); err != nil {
			t.Fatalf("insert Commerce Vertical fixture: %v", err)
		}
		created, err := postgres.CreateJoiningCaseForField(ctx, db, "idem-field-media-case", postgres.HashJoiningCaseRequest("+967700000198", "نشاط الوسائط", "متجر الوسائط", serviceCityID, verticalID, 15.369445, 44.191006, []string{postgres.FulfillmentModeBthwaniCaptain}), fieldActorID, "corr-field-media-case", "+967700000198", "نشاط الوسائط", "متجر الوسائط", serviceCityID, verticalID, 15.369445, 44.191006, []string{postgres.FulfillmentModeBthwaniCaptain})
		if err != nil {
			t.Fatalf("create Field joining case fixture: %v", err)
		}

		assetInput := func(name string, expectedVersion int, digest string) postgres.StoreProfileMediaAssetInput {
			id := "store_profile_media_test_" + name
			key := "idem_store_profile_media_test_" + name
			return postgres.StoreProfileMediaAssetInput{
				ID: id, JoiningCaseID: created.Case.ID, IdempotencyKey: key,
				RequestHash:         postgres.HashStoreProfileMediaUploadRequest(created.Case.ID, digest, expectedVersion),
				ExpectedCaseVersion: expectedVersion, ObjectKey: "store-profile-media/" + id + ".png",
				URI: "https://media.example/" + id + ".png", ContentSHA256: digest, ContentType: "image/png",
				ByteSize: 1, ActingActorID: fieldActorID, CorrelationID: "corr_store_profile_media_" + name,
			}
		}
		firstInput := assetInput("first", 1, strings.Repeat("a", 64))
		first, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, firstInput)
		if err != nil || replayed || first.State != "pending" {
			t.Fatalf("register first store image failed: %+v replayed=%t err=%v", first, replayed, err)
		}
		if version, err := postgres.ActivateStoreProfileMediaAsset(ctx, db, first.ID, created.Case.ID, 1, firstInput.IdempotencyKey, firstInput.RequestHash, fieldActorID, firstInput.CorrelationID); err != nil || version != 2 {
			t.Fatalf("activate first store image: version=%d err=%v", version, err)
		}
		replayedAsset, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, firstInput)
		if err != nil || !replayed || replayedAsset.State != "active" {
			t.Fatalf("same-key image retry after version advance did not replay: %+v replayed=%t err=%v", replayedAsset, replayed, err)
		}

		secondInput := assetInput("second", 2, strings.Repeat("b", 64))
		second, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, secondInput)
		if err != nil || replayed {
			t.Fatalf("register replacement store image failed: %+v replayed=%t err=%v", second, replayed, err)
		}
		if version, err := postgres.ActivateStoreProfileMediaAsset(ctx, db, second.ID, created.Case.ID, 2, secondInput.IdempotencyKey, secondInput.RequestHash, fieldActorID, secondInput.CorrelationID); err != nil || version != 3 {
			t.Fatalf("activate replacement store image: version=%d err=%v", version, err)
		}

		failedInput := assetInput("failed", 3, strings.Repeat("c", 64))
		failed, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, failedInput)
		if err != nil || replayed {
			t.Fatalf("register failed-upload fixture: %+v replayed=%t err=%v", failed, replayed, err)
		}
		if err := postgres.MarkStoreProfileMediaAssetFailed(ctx, db, failed.ID, "fixture upload failure"); err != nil {
			t.Fatalf("mark failed-upload fixture: %v", err)
		}

		pendingInput := assetInput("abandoned", 3, strings.Repeat("d", 64))
		pending, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, pendingInput)
		if err != nil || replayed {
			t.Fatalf("register abandoned-upload fixture: %+v replayed=%t err=%v", pending, replayed, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET created_at=clock_timestamp()-interval '11 minutes',last_attempt_at=clock_timestamp()-interval '11 minutes' WHERE id=$1", pending.ID); err != nil {
			t.Fatalf("age abandoned-upload fixture: %v", err)
		}

		retryingInput := assetInput("retrying", 3, strings.Repeat("e", 64))
		retrying, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, retryingInput)
		if err != nil || replayed {
			t.Fatalf("register retryable-upload fixture: %+v replayed=%t err=%v", retrying, replayed, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET created_at=clock_timestamp()-interval '11 minutes',last_attempt_at=clock_timestamp()-interval '11 minutes' WHERE id=$1", retrying.ID); err != nil {
			t.Fatalf("age retryable-upload fixture: %v", err)
		}
		if replayedAsset, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, retryingInput); err != nil || !replayed || replayedAsset.State != "pending" {
			t.Fatalf("retry did not refresh pending upload before cleanup: %+v replayed=%t err=%v", replayedAsset, replayed, err)
		}

		cleanupAssets, err := postgres.ClaimStoreProfileMediaAssetsForCleanup(ctx, db, 100)
		if err != nil {
			t.Fatalf("claim store profile media for cleanup: %v", err)
		}
		cleanupIDs := make(map[string]struct{}, len(cleanupAssets))
		for _, asset := range cleanupAssets {
			cleanupIDs[asset.ID] = struct{}{}
		}
		for _, id := range []string{first.ID, failed.ID, pending.ID} {
			if _, ok := cleanupIDs[id]; !ok {
				t.Errorf("cleanup queue omitted non-current media asset %s", id)
			}
		}
		if _, ok := cleanupIDs[retrying.ID]; ok {
			t.Errorf("cleanup claimed a pending upload immediately after its retry %s", retrying.ID)
		}
		if _, ok := cleanupIDs[second.ID]; ok {
			t.Errorf("cleanup queue included the active store image %s", second.ID)
		}
		for _, asset := range cleanupAssets {
			if asset.ID == pending.ID {
				if _, _, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, pendingInput); err != postgres.ErrStoreProfileMediaCleanupBusy {
					t.Errorf("pending upload retry was not fenced while cleanup owned it: %v", err)
				}
				if _, err := postgres.ActivateStoreProfileMediaAsset(ctx, db, asset.ID, pendingInput.JoiningCaseID, pendingInput.ExpectedCaseVersion, pendingInput.IdempotencyKey, pendingInput.RequestHash, pendingInput.ActingActorID, pendingInput.CorrelationID); err != postgres.ErrStoreProfileMediaCleanupBusy {
					t.Errorf("pending upload activated while cleanup owned it: %v", err)
				}
				if _, err := db.ExecContext(ctx, "UPDATE dsh.store_profile_media_assets SET cleanup_claimed_at=$2-interval '3 minutes' WHERE id=$1 AND cleanup_claimed_at=$2", asset.ID, asset.CleanupClaimedAt); err != nil {
					t.Fatalf("expire first cleanup claim: %v", err)
				}
				reclaimed, err := postgres.ClaimStoreProfileMediaAssetsForCleanup(ctx, db, 100)
				if err != nil || len(reclaimed) != 1 || reclaimed[0].ID != pending.ID || reclaimed[0].CleanupClaimedAt.Equal(asset.CleanupClaimedAt) {
					t.Fatalf("expired cleanup claim was not replaced: assets=%+v err=%v", reclaimed, err)
				}
				if err := postgres.MarkStoreProfileMediaAssetCleanupComplete(ctx, db, asset.ID, asset.CleanupClaimedAt); err != postgres.ErrStoreProfileMediaCleanupBusy {
					t.Errorf("expired cleanup worker completed a newer claim: %v", err)
				}
				if err := postgres.MarkStoreProfileMediaAssetCleanupFailure(ctx, db, asset.ID, asset.CleanupClaimedAt, "stale cleanup worker"); err != postgres.ErrStoreProfileMediaCleanupBusy {
					t.Errorf("expired cleanup worker released a newer claim: %v", err)
				}
				if _, _, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, pendingInput); err != postgres.ErrStoreProfileMediaCleanupBusy {
					t.Errorf("upload retry escaped the replacement cleanup claim: %v", err)
				}
				if err := postgres.MarkStoreProfileMediaAssetCleanupComplete(ctx, db, reclaimed[0].ID, reclaimed[0].CleanupClaimedAt); err != nil {
					t.Fatalf("complete replacement cleanup claim: %v", err)
				}
				continue
			}
			if err := postgres.MarkStoreProfileMediaAssetCleanupComplete(ctx, db, asset.ID, asset.CleanupClaimedAt); err != nil {
				t.Fatalf("mark claimed store media asset %s cleaned: %v", asset.ID, err)
			}
		}
		remaining, err := postgres.ClaimStoreProfileMediaAssetsForCleanup(ctx, db, 100)
		if err != nil || len(remaining) != 0 {
			t.Fatalf("cleaned store media remained in cleanup queue: count=%d err=%v", len(remaining), err)
		}
		retriedFailed, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, failedInput)
		if err != nil || !replayed || retriedFailed.State != "pending" {
			t.Fatalf("cleaned failed upload could not be retried with the same idempotency key: %+v replayed=%t err=%v", retriedFailed, replayed, err)
		}
		if err := postgres.MarkStoreProfileMediaAssetFailed(ctx, db, retriedFailed.ID, "fixture retry failure"); err != nil {
			t.Fatalf("mark retried upload failed: %v", err)
		}
		retryCleanup, err := postgres.ClaimStoreProfileMediaAssetsForCleanup(ctx, db, 100)
		if err != nil || len(retryCleanup) != 1 || retryCleanup[0].ID != retriedFailed.ID {
			t.Fatalf("retried failed object was not returned to cleanup: assets=%+v err=%v", retryCleanup, err)
		}
		if err := postgres.MarkStoreProfileMediaAssetCleanupComplete(ctx, db, retriedFailed.ID, retryCleanup[0].CleanupClaimedAt); err != nil {
			t.Fatalf("clean retried failed media object: %v", err)
		}
		var pendingState string
		var pendingCleanedAt sql.NullTime
		if err := db.QueryRowContext(ctx, "SELECT state,cleaned_at FROM dsh.store_profile_media_assets WHERE id=$1", pending.ID).Scan(&pendingState, &pendingCleanedAt); err != nil || pendingState != "failed" || !pendingCleanedAt.Valid {
			t.Fatalf("abandoned pending object lacks terminal cleanup state: state=%q cleaned_at=%v err=%v", pendingState, pendingCleanedAt, err)
		}
		active, err := postgres.ReadStoreProfileMedia(ctx, db, created.Case.ID, "")
		if err != nil || active == nil || active.ID != second.ID {
			t.Fatalf("cleanup changed canonical active store image: active=%+v err=%v", active, err)
		}
	})
}
