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
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply canonical DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify canonical DSH schema: %v", err)
		}

		suffix := fmt.Sprintf("%d", time.Now().UTC().UnixNano())
		verticalID := "storetype-vertical-" + suffix
		vertical := postgres.CommerceVerticalRecord{
			ID: verticalID, NameAr: "تصنيف اختبار", NameEn: "Test Vertical",
			CatalogModel: "SHARED_CATALOG", Active: true,
		}
		verticalReason := "Create commercial type test vertical"
		verticalAudit := postgres.CatalogRegistryAuditInput{
			ActingActorID: testOperatorActorID,
			CorrelationID: "corr-storetype-vertical-" + suffix,
			Reason:        verticalReason,
		}
		createdVertical, err := postgres.CreateCommerceVertical(ctx, db, vertical, "idem-storetype-vertical-"+suffix,
			postgres.HashCatalogVerticalCreateRequest(vertical, verticalReason), verticalAudit)
		if err != nil {
			t.Fatalf("create commercial type owner vertical: %v", err)
		}
		verticalID = createdVertical.Vertical.ID

		item := postgres.CommercialStoreTypeRecord{
			ID: "commercial-type-" + suffix, VerticalID: verticalID,
			NameAr: "محل جزارة", NameEn: "Butcher Shop", Active: true,
		}
		createReason := "Add butcher commercial type"
		createAudit := postgres.CatalogRegistryAuditInput{
			ActingActorID: testOperatorActorID,
			CorrelationID: "corr-storetype-create-" + suffix,
			Reason:        createReason,
		}
		createKey := "idem-storetype-create-" + suffix
		createHash := postgres.HashCommercialStoreTypeCreateRequest(item, createReason)
		created, err := postgres.CreateCommercialStoreType(ctx, db, item, createKey, createHash, createAudit)
		if err != nil || created.Replayed || created.StoreType.ID != item.ID || created.StoreType.Version != 1 {
			t.Fatalf("create commercial store type = %+v, error=%v", created, err)
		}
		replayed, err := postgres.CreateCommercialStoreType(ctx, db, item, createKey, createHash, createAudit)
		if err != nil || !replayed.Replayed || replayed.StoreType.ID != created.StoreType.ID || replayed.StoreType.Version != 1 {
			t.Fatalf("replay commercial store type create = %+v, error=%v", replayed, err)
		}
		conflictingCreate := item
		conflictingCreate.NameEn = "Fish Shop"
		if _, err := postgres.CreateCommercialStoreType(ctx, db, conflictingCreate, createKey,
			postgres.HashCommercialStoreTypeCreateRequest(conflictingCreate, createReason), createAudit); !errors.Is(err, postgres.ErrCatalogIdempotencyConflict) {
			t.Fatalf("changed create request error = %v", err)
		}
		missingVertical := item
		missingVertical.ID = "missing-vertical-type-" + suffix
		missingVertical.VerticalID = "missing-vertical-" + suffix
		if _, err := postgres.CreateCommercialStoreType(ctx, db, missingVertical, "idem-storetype-missing-"+suffix,
			postgres.HashCommercialStoreTypeCreateRequest(missingVertical, createReason), createAudit); !errors.Is(err, postgres.ErrCatalogVerticalNotFound) {
			t.Fatalf("missing owner vertical create error = %v", err)
		}

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

		update := postgres.UpdateCommercialStoreTypeInput{
			NameAr: "محل أسماك", NameEn: "Fish Shop", Active: false, ExpectedVersion: 1,
		}
		updateReason := "Rename and deactivate type"
		updateAudit := postgres.CatalogRegistryAuditInput{
			ActingActorID: testOperatorActorID,
			CorrelationID: "corr-storetype-update-" + suffix,
			Reason:        updateReason,
		}
		updateKey := "idem-storetype-update-" + suffix
		updateHash := postgres.HashCommercialStoreTypeUpdateRequest(item.ID, update, updateReason)
		updated, err := postgres.UpdateCommercialStoreType(ctx, db, item.ID, update, updateKey, updateHash, updateAudit)
		if err != nil || updated.Replayed || updated.StoreType.Version != 2 || updated.StoreType.Active || updated.StoreType.NameEn != "Fish Shop" {
			t.Fatalf("update commercial store type = %+v, error=%v", updated, err)
		}
		updateReplay, err := postgres.UpdateCommercialStoreType(ctx, db, item.ID, update, updateKey, updateHash, updateAudit)
		if err != nil || !updateReplay.Replayed || updateReplay.StoreType.Version != 2 {
			t.Fatalf("replay commercial store type update = %+v, error=%v", updateReplay, err)
		}
		changedUpdate := update
		changedUpdate.NameEn = "Seafood Shop"
		if _, err := postgres.UpdateCommercialStoreType(ctx, db, item.ID, changedUpdate, updateKey,
			postgres.HashCommercialStoreTypeUpdateRequest(item.ID, changedUpdate, updateReason), updateAudit); !errors.Is(err, postgres.ErrCatalogIdempotencyConflict) {
			t.Fatalf("changed update request error = %v", err)
		}
		staleUpdate := update
		staleUpdate.ExpectedVersion = 1
		staleUpdate.NameEn = "Stale Name"
		if _, err := postgres.UpdateCommercialStoreType(ctx, db, item.ID, staleUpdate, "idem-storetype-stale-"+suffix,
			postgres.HashCommercialStoreTypeUpdateRequest(item.ID, staleUpdate, updateReason), updateAudit); !errors.Is(err, postgres.ErrCatalogVersionConflict) {
			t.Fatalf("stale update version error = %v", err)
		}
		if _, err := postgres.ReadActiveCommercialStoreType(ctx, db, item.ID); !errors.Is(err, postgres.ErrCommercialStoreTypeNotFound) {
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
	})
}
