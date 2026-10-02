package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestCommercialStoreTypeRegistryLifecycle(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh commercial store type proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open DSH test PostgreSQL: %v", err)
	}
	t.Cleanup(func() {
		if err := rootDB.Close(); err != nil {
			t.Errorf("close DSH test PostgreSQL: %v", err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("connect DSH test PostgreSQL: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		runCommercialStoreTypeScenario(t, ctx, db, records, migrationSQL)
	})
}

func runCommercialStoreTypeScenario(t *testing.T, ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
	t.Helper()
	if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
		t.Fatalf("apply canonical DSH migrations: %v", err)
	}
	if err := postgres.VerifySchema(ctx, db, records); err != nil {
		t.Fatalf("verify canonical DSH schema: %v", err)
	}

	suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
	verticalID := createCommercialTypeVertical(t, ctx, db, suffix)
	item := createCommercialTypeAndVerifyIdempotency(t, ctx, db, verticalID, suffix)
	verifyCommercialTypeReads(t, ctx, db, item, verticalID, suffix)
	updateCommercialType(t, ctx, db, item, verticalID, suffix)
	verifyStoreCommercialTypeAssignment(t, ctx, db, item, verticalID, suffix)
}

func verifyStoreCommercialTypeAssignment(t *testing.T, ctx context.Context, db *sql.DB, item postgres.CommercialStoreTypeRecord, verticalID, suffix string) {
	t.Helper()
	storeID := "store-type-assignment-" + suffix
	insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: "partner-type-assignment-" + suffix, Name: "Assignment fixture", PrimaryVerticalID: verticalID})
	if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET commercial_store_type_id=NULL, version=1 WHERE id=$1", storeID); err != nil {
		t.Fatalf("prepare store for commercial type assignment: %v", err)
	}
	input := postgres.StoreCommercialTypeAssignmentInput{
		StoreID: storeID, TypeID: item.ID, ActorID: testOperatorActorID,
		Reason: "Assign commercial type", CorrelationID: "corr-store-type-assignment-" + suffix,
		IdempotencyKey: "idem-store-type-assignment-" + suffix, ExpectedVersion: 1,
	}
	assigned, err := postgres.SetStoreCommercialType(ctx, db, input)
	if err != nil || assigned.StoreID != storeID || assigned.CommercialStoreTypeID != item.ID || assigned.Version != 2 || assigned.Replayed {
		t.Fatalf("assign commercial type = %+v, error=%v", assigned, err)
	}
	replayed, err := postgres.SetStoreCommercialType(ctx, db, input)
	if err != nil || !replayed.Replayed || replayed.Version != assigned.Version || replayed.CommercialStoreTypeID != item.ID {
		t.Fatalf("replay commercial type assignment = %+v, error=%v", replayed, err)
	}
	changed := input
	changed.Reason = "Changed assignment reason"
	if _, err := postgres.SetStoreCommercialType(ctx, db, changed); !errors.Is(err, postgres.ErrCatalogIdempotencyConflict) {
		t.Fatalf("changed assignment replay error = %v", err)
	}
	stale := input
	stale.IdempotencyKey += "-stale"
	if _, err := postgres.SetStoreCommercialType(ctx, db, stale); !errors.Is(err, postgres.ErrStoreCommercialTypeAssignmentVersion) {
		t.Fatalf("stale assignment version error = %v", err)
	}
	if _, err := postgres.SetStoreCommercialType(ctx, db, postgres.StoreCommercialTypeAssignmentInput{StoreID: "missing-store", TypeID: item.ID, ActorID: testOperatorActorID, Reason: input.Reason, CorrelationID: "corr-missing-store-" + suffix, IdempotencyKey: "idem-missing-store-" + suffix, ExpectedVersion: 1}); !errors.Is(err, postgres.ErrStoreCommercialTypeAssignmentConflict) {
		t.Fatalf("missing store assignment error = %v", err)
	}
	if _, err := postgres.SetStoreCommercialType(ctx, nil, input); !errors.Is(err, postgres.ErrStoreCommercialTypeAssignmentInvalid) {
		t.Fatalf("nil database assignment error = %v", err)
	}
}

func createCommercialTypeVertical(t *testing.T, ctx context.Context, db *sql.DB, suffix string) string {
	t.Helper()
	vertical := postgres.CommerceVerticalRecord{
		ID: "storetype-vertical-" + suffix, NameAr: "تصنيف اختبار", NameEn: "Test Vertical",
		CatalogModel: "SHARED_CATALOG", Active: true,
	}
	reason := "Create commercial type test vertical"
	audit := postgres.CatalogRegistryAuditInput{
		ActingActorID: testOperatorActorID,
		CorrelationID: "corr-storetype-vertical-" + suffix,
		Reason:        reason,
	}
	created, err := postgres.CreateCommerceVertical(ctx, db, vertical, "idem-storetype-vertical-"+suffix,
		postgres.HashCatalogVerticalCreateRequest(vertical, reason), audit)
	if err != nil {
		t.Fatalf("create commercial type owner vertical: %v", err)
	}
	return created.Vertical.ID
}

func createCommercialTypeAndVerifyIdempotency(t *testing.T, ctx context.Context, db *sql.DB, verticalID, suffix string) postgres.CommercialStoreTypeRecord {
	t.Helper()
	item := postgres.CommercialStoreTypeRecord{
		ID: "commercial-type-" + suffix, VerticalID: verticalID,
		NameAr: "محل جزارة", NameEn: "Butcher Shop", Active: true,
	}
	reason := "Add butcher commercial type"
	audit := postgres.CatalogRegistryAuditInput{
		ActingActorID: testOperatorActorID,
		CorrelationID: "corr-storetype-create-" + suffix,
		Reason:        reason,
	}
	key := "idem-storetype-create-" + suffix
	hash := postgres.HashCommercialStoreTypeCreateRequest(item, reason)
	created, err := postgres.CreateCommercialStoreType(ctx, db, item, key, hash, audit)
	if err != nil || created.Replayed || created.StoreType.ID != item.ID || created.StoreType.Version != 1 {
		t.Fatalf("create commercial store type = %+v, error=%v", created, err)
	}
	replayed, err := postgres.CreateCommercialStoreType(ctx, db, item, key, hash, audit)
	if err != nil || !replayed.Replayed || replayed.StoreType.ID != item.ID || replayed.StoreType.Version != 1 {
		t.Fatalf("replay commercial store type create = %+v, error=%v", replayed, err)
	}
	conflicting := item
	conflicting.NameEn = "Fish Shop"
	if _, err := postgres.CreateCommercialStoreType(ctx, db, conflicting, key,
		postgres.HashCommercialStoreTypeCreateRequest(conflicting, reason), audit); !errors.Is(err, postgres.ErrCatalogIdempotencyConflict) {
		t.Fatalf("changed create request error = %v", err)
	}
	missingVertical := item
	missingVertical.ID = "missing-vertical-type-" + suffix
	missingVertical.VerticalID = "missing-vertical-" + suffix
	if _, err := postgres.CreateCommercialStoreType(ctx, db, missingVertical, "idem-storetype-missing-"+suffix,
		postgres.HashCommercialStoreTypeCreateRequest(missingVertical, reason), audit); !errors.Is(err, postgres.ErrCatalogVerticalNotFound) {
		t.Fatalf("missing owner vertical create error = %v", err)
	}
	return created.StoreType
}

func verifyCommercialTypeReads(t *testing.T, ctx context.Context, db *sql.DB, item postgres.CommercialStoreTypeRecord, verticalID, suffix string) {
	t.Helper()
	listed, err := postgres.ListCommercialStoreTypes(ctx, db, verticalID, true)
	if err != nil || len(listed) != 1 || listed[0].ID != item.ID {
		t.Fatalf("active vertical commercial type list = %+v, error=%v", listed, err)
	}
	read, err := postgres.ReadCommercialStoreType(ctx, db, item.ID)
	if err != nil || read.NameEn != item.NameEn || read.Version != 1 {
		t.Fatalf("commercial type read = %+v, error=%v", read, err)
	}
	active, err := postgres.ReadActiveCommercialStoreType(ctx, db, item.ID)
	if err != nil || !active.Active || active.VerticalID != verticalID {
		t.Fatalf("active commercial type read = %+v, error=%v", active, err)
	}
	if _, err := postgres.ReadCommercialStoreType(ctx, db, "missing-type-"+suffix); !errors.Is(err, postgres.ErrCommercialStoreTypeNotFound) {
		t.Fatalf("missing commercial type read error = %v", err)
	}
	if _, err := postgres.ReadActiveCommercialStoreType(ctx, db, "missing-type-"+suffix); !errors.Is(err, postgres.ErrCommercialStoreTypeNotFound) {
		t.Fatalf("missing active commercial type read error = %v", err)
	}
	if _, err := postgres.ReadCommercialStoreType(ctx, db, strings.Repeat("x", 129)); !errors.Is(err, postgres.ErrCommercialStoreTypeInvalid) {
		t.Fatalf("invalid commercial type read error = %v", err)
	}
}

func updateCommercialType(t *testing.T, ctx context.Context, db *sql.DB, item postgres.CommercialStoreTypeRecord, verticalID, suffix string) {
	t.Helper()
	update := postgres.UpdateCommercialStoreTypeInput{
		NameAr: "محل أسماك", NameEn: "Fish Shop", Active: false, ExpectedVersion: 1,
	}
	reason := "Rename and deactivate type"
	audit := postgres.CatalogRegistryAuditInput{
		ActingActorID: testOperatorActorID,
		CorrelationID: "corr-storetype-update-" + suffix,
		Reason:        reason,
	}
	key := "idem-storetype-update-" + suffix
	hash := postgres.HashCommercialStoreTypeUpdateRequest(item.ID, update, reason)
	updated, err := postgres.UpdateCommercialStoreType(ctx, db, item.ID, update, key, hash, audit)
	if err != nil || updated.Replayed || updated.StoreType.Version != 2 || updated.StoreType.Active || updated.StoreType.NameEn != "Fish Shop" {
		t.Fatalf("update commercial store type = %+v, error=%v", updated, err)
	}
	replayed, err := postgres.UpdateCommercialStoreType(ctx, db, item.ID, update, key, hash, audit)
	if err != nil || !replayed.Replayed || replayed.StoreType.Version != 2 {
		t.Fatalf("replay commercial store type update = %+v, error=%v", replayed, err)
	}
	verifyCommercialTypeUpdateFailures(t, ctx, db, commercialTypeUpdateFailureCase{
		id: item.ID, update: update, key: key, reason: reason, audit: audit, suffix: suffix,
	})
	verifyInactiveCommercialTypeReads(t, ctx, db, item.ID, verticalID)
}

type commercialTypeUpdateFailureCase struct {
	id     string
	update postgres.UpdateCommercialStoreTypeInput
	key    string
	reason string
	audit  postgres.CatalogRegistryAuditInput
	suffix string
}

func verifyCommercialTypeUpdateFailures(t *testing.T, ctx context.Context, db *sql.DB, scenario commercialTypeUpdateFailureCase) {
	t.Helper()
	changed := scenario.update
	changed.NameEn = "Seafood Shop"
	if _, err := postgres.UpdateCommercialStoreType(ctx, db, scenario.id, changed, scenario.key,
		postgres.HashCommercialStoreTypeUpdateRequest(scenario.id, changed, scenario.reason), scenario.audit); !errors.Is(err, postgres.ErrCatalogIdempotencyConflict) {
		t.Fatalf("changed update request error = %v", err)
	}
	stale := scenario.update
	stale.ExpectedVersion = 1
	stale.NameEn = "Stale Name"
	if _, err := postgres.UpdateCommercialStoreType(ctx, db, scenario.id, stale, "idem-storetype-stale-"+scenario.suffix,
		postgres.HashCommercialStoreTypeUpdateRequest(scenario.id, stale, scenario.reason), scenario.audit); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
		t.Fatalf("stale update version error = %v", err)
	}
}

func verifyInactiveCommercialTypeReads(t *testing.T, ctx context.Context, db *sql.DB, id, verticalID string) {
	t.Helper()
	if _, err := postgres.ReadActiveCommercialStoreType(ctx, db, id); !errors.Is(err, postgres.ErrCommercialStoreTypeNotFound) {
		t.Fatalf("inactive commercial type remains visible as active: %v", err)
	}
	inactiveTypes, err := postgres.ListCommercialStoreTypes(ctx, db, verticalID, true)
	if err != nil || len(inactiveTypes) != 0 {
		t.Fatalf("active-only list returned inactive type: %+v, error=%v", inactiveTypes, err)
	}
	allTypes, err := postgres.ListCommercialStoreTypes(ctx, db, verticalID, false)
	if err != nil || len(allTypes) != 1 || allTypes[0].Version != 2 {
		t.Fatalf("unfiltered type list = %+v, error=%v", allTypes, err)
	}
}
