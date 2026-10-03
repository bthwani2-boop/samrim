package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestFreshStoreOperationalAvailabilityJourney(t *testing.T) {
	databaseURL := os.Getenv("DSH_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh DSH proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open configured Postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured Postgres is not reachable: %v", err)
	}

	databaseName := fmt.Sprintf("dsh_availability_test_%d", time.Now().UnixNano())
	if _, err := rootDB.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatalf("create isolated DSH database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := rootDB.ExecContext(cleanupCtx, "DROP DATABASE IF EXISTS "+databaseName+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated DSH database: %v", err)
		}
	})
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse configured Postgres URL: %v", err)
	}
	parsedURL.Path = "/" + databaseName
	db, err := sql.Open("postgres", parsedURL.String())
	if err != nil {
		t.Fatalf("open isolated DSH database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("isolated DSH database is not reachable: %v", err)
	}
	migrationDirectory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	records, migrations, err := postgres.LoadCanonicalMigrations(migrationDirectory)
	if err != nil {
		t.Fatalf("load canonical DSH migration graph: %v", err)
	}
	if err := postgres.MigrateCanonical(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
		t.Fatalf("apply canonical DSH migrations: %v", err)
	}
	if err := postgres.VerifyCanonicalSchema(ctx, db, records); err != nil {
		t.Fatalf("verify canonical DSH schema: %v", err)
	}

	const storeID = "store_availability_refoundation"
	insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: testPartnerActorID, Name: "متجر الإتاحة", PrimaryVerticalID: "vertical_availability_refoundation", PublicationState: "published"})
	initial, err := postgres.ReadStoreOperationalAvailability(ctx, db, storeID)
	if err != nil || initial.ScheduleMode != "ALWAYS_OPEN" || initial.Version != 1 {
		t.Fatalf("default availability readback failed: %+v err=%v", initial, err)
	}
	openAt := time.Date(2026, time.October, 4, 12, 0, 0, 0, time.UTC)
	result, err := postgres.EvaluateStoreOrderability(ctx, db, storeID, "BTHWANI_CAPTAIN", openAt)
	if err != nil || result.State != postgres.StoreOrderabilityOpenForOrders {
		t.Fatalf("default Store must accept orders across its enabled mode: %+v err=%v", result, err)
	}
	preparation := 25
	weeklyInput := postgres.UpdateStoreOperationalAvailabilityInput{
		StoreID: storeID, ScheduleMode: "WEEKLY",
		WeeklySchedule:     []postgres.StoreScheduleWindow{{DayOfWeek: 0, OpensAtMinute: 9 * 60, ClosesAtMinute: 17 * 60}},
		PreparationMinutes: &preparation, ExpectedVersion: 1, ActingActorID: testPartnerActorID, AuthoritySource: "STORE_OWNER",
		IdempotencyKey: "availability_weekly_v1", CorrelationID: "availability_weekly_corr_v1",
	}
	weekly, replayed, err := postgres.UpdateStoreOperationalAvailability(ctx, db, weeklyInput)
	if err != nil || replayed || weekly.Version != 2 || weekly.ScheduleMode != "WEEKLY" {
		t.Fatalf("weekly hours update failed: %+v replayed=%t err=%v", weekly, replayed, err)
	}
	replay, replayed, err := postgres.UpdateStoreOperationalAvailability(ctx, db, weeklyInput)
	if err != nil || !replayed || replay.Version != weekly.Version {
		t.Fatalf("availability idempotent replay failed: %+v replayed=%t err=%v", replay, replayed, err)
	}
	withinSchedule, err := postgres.EvaluateStoreOrderability(ctx, db, storeID, "BTHWANI_CAPTAIN", openAt)
	if err != nil || withinSchedule.State != postgres.StoreOrderabilityOpenForOrders || withinSchedule.PreparationMinutes == nil || *withinSchedule.PreparationMinutes != preparation {
		t.Fatalf("weekly schedule should accept orders within local Yemen hours and read preparation time: %+v err=%v", withinSchedule, err)
	}
	outsideSchedule, err := postgres.EvaluateStoreOrderability(ctx, db, storeID, "BTHWANI_CAPTAIN", time.Date(2026, time.October, 4, 18, 0, 0, 0, time.UTC))
	if err != nil || outsideSchedule.State != postgres.StoreOrderabilityClosedBySchedule {
		t.Fatalf("weekly schedule should reject orders outside local Yemen hours: %+v err=%v", outsideSchedule, err)
	}
	invalidMode := weeklyInput
	invalidMode.ExpectedVersion = weekly.Version
	invalidMode.UnavailableFulfillmentModes = []string{"PARTNER_CAPTAIN"}
	invalidMode.IdempotencyKey = "availability_bad_mode_v1"
	invalidMode.CorrelationID = "availability_bad_mode_corr_v1"
	if _, _, err := postgres.UpdateStoreOperationalAvailability(ctx, db, invalidMode); !errors.Is(err, postgres.ErrStoreOperationalAvailabilityInvalid) {
		t.Fatalf("unadmitted temporary fulfillment mode must be rejected, got %v", err)
	}
	overlap := weeklyInput
	overlap.ExpectedVersion = weekly.Version
	overlap.WeeklySchedule = []postgres.StoreScheduleWindow{{DayOfWeek: 0, OpensAtMinute: 9 * 60, ClosesAtMinute: 13 * 60}, {DayOfWeek: 0, OpensAtMinute: 12 * 60, ClosesAtMinute: 17 * 60}}
	overlap.IdempotencyKey = "availability_overlap_v1"
	overlap.CorrelationID = "availability_overlap_corr_v1"
	if _, _, err := postgres.UpdateStoreOperationalAvailability(ctx, db, overlap); !errors.Is(err, postgres.ErrStoreOperationalAvailabilityInvalid) {
		t.Fatalf("overlapping weekly windows must be rejected, got %v", err)
	}
	pausedInput := weeklyInput
	pausedInput.ExpectedVersion = weekly.Version
	pausedInput.Paused = true
	pauseReason := "إيقاف تجريبي مؤقت"
	pausedInput.PauseReason = &pauseReason
	pausedInput.IdempotencyKey = "availability_pause_v1"
	pausedInput.CorrelationID = "availability_pause_corr_v1"
	paused, _, err := postgres.UpdateStoreOperationalAvailability(ctx, db, pausedInput)
	if err != nil || !paused.Paused || paused.Version != weekly.Version+1 {
		t.Fatalf("temporary Store pause update failed: %+v err=%v", paused, err)
	}
	pausedOrderability, err := postgres.EvaluateStoreOrderability(ctx, db, storeID, "BTHWANI_CAPTAIN", openAt)
	if err != nil || pausedOrderability.State != postgres.StoreOrderabilityPaused || pausedOrderability.Reason == nil || *pausedOrderability.Reason != pauseReason {
		t.Fatalf("paused Store must expose its current pause reason: %+v err=%v", pausedOrderability, err)
	}
	var publicationState string
	if err := db.QueryRowContext(ctx, "SELECT publication_state FROM dsh.stores WHERE id=$1", storeID).Scan(&publicationState); err != nil || publicationState != "published" {
		t.Fatalf("operational changes must not alter publication state: state=%s err=%v", publicationState, err)
	}
}
