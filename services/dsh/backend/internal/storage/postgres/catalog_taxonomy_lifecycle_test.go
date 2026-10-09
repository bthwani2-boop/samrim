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
	_ "github.com/lib/pq"
)

func TestCatalogCategoryTreeAndVerticalActivityLifecycle(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the isolated catalog taxonomy proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open DSH test PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
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
		vertical := createClosureVertical(t, ctx, db, "tree-vertical-", suffix)
		otherVertical := createClosureVertical(t, ctx, db, "tree-other-vertical-", suffix)
		rootA := createClosureCategory(t, ctx, db, vertical.ID, "tree-root-a-"+suffix, "مشروبات", "Drinks", "", suffix)
		rootB := createClosureCategory(t, ctx, db, vertical.ID, "tree-root-b-"+suffix, "ساخنة", "Hot Drinks", "", suffix)
		crossVertical := createClosureCategory(t, ctx, db, otherVertical.ID, "tree-cross-"+suffix, "فواكه", "Fruit", "", suffix)
		child := createClosureCategory(t, ctx, db, vertical.ID, "tree-child-"+suffix, "قهوة", "Coffee", rootA.ID, suffix)
		branchLeft := createClosureCategory(t, ctx, db, vertical.ID, "tree-race-left-"+suffix, "فرع يسار", "Left Branch", "", suffix)
		branchRight := createClosureCategory(t, ctx, db, vertical.ID, "tree-race-right-"+suffix, "فرع يمين", "Right Branch", "", suffix)
		raceStart := make(chan struct{})
		raceResults := make(chan error, 2)
		raceMoves := []struct {
			categoryID, parentID, reason, correlationID, idempotencyKey string
		}{
			{branchLeft.ID, branchRight.ID, "Race left branch beneath right", "corr-tree-race-move-left-" + suffix, "idem-tree-race-move-left-" + suffix},
			{branchRight.ID, branchLeft.ID, "Race right branch beneath left", "corr-tree-race-move-right-" + suffix, "idem-tree-race-move-right-" + suffix},
		}
		for _, move := range raceMoves {
			go func(move struct {
				categoryID, parentID, reason, correlationID, idempotencyKey string
			}) {
				<-raceStart
				current := branchLeft
				if move.categoryID == branchRight.ID {
					current = branchRight
				}
				input := postgres.UpdateCatalogCategoryInput{ParentCategoryID: move.parentID, NameAr: current.NameAr, NameEn: current.NameEn, Active: true, ExpectedVersion: 1}
				_, _, err := postgres.UpdateCatalogCategory(ctx, db, move.categoryID, input, move.idempotencyKey, postgres.HashCatalogCategoryUpdateRequest(move.categoryID, input, move.reason), closureAudit(move.correlationID, move.reason))
				raceResults <- err
			}(move)
		}
		close(raceStart)
		concurrentMoves, concurrentCycles := 0, 0
		for range raceMoves {
			err := <-raceResults
			switch {
			case err == nil:
				concurrentMoves++
			case errors.Is(err, postgres.ErrCatalogCategoryCycle):
				concurrentCycles++
			default:
				t.Fatalf("concurrent opposing category move error=%v", err)
			}
		}
		if concurrentMoves != 1 || concurrentCycles != 1 {
			t.Fatalf("concurrent opposing category moves succeeded=%d cycle rejections=%d, want one each", concurrentMoves, concurrentCycles)
		}

		cycleInput := postgres.UpdateCatalogCategoryInput{ParentCategoryID: child.ID, NameAr: rootA.NameAr, NameEn: rootA.NameEn, Active: true, ExpectedVersion: 1}
		cycleReason := "Move root beneath its child"
		if _, _, err := postgres.UpdateCatalogCategory(ctx, db, rootA.ID, cycleInput, "idem-tree-cycle-"+suffix, postgres.HashCatalogCategoryUpdateRequest(rootA.ID, cycleInput, cycleReason), closureAudit("corr-tree-cycle-"+suffix, cycleReason)); !errors.Is(err, postgres.ErrCatalogCategoryCycle) {
			t.Fatalf("cycle-producing parent move error=%v, want cycle rejection", err)
		}
		crossInput := postgres.UpdateCatalogCategoryInput{ParentCategoryID: crossVertical.ID, NameAr: child.NameAr, NameEn: child.NameEn, Active: true, ExpectedVersion: 1}
		crossReason := "Move category to another vertical"
		if _, _, err := postgres.UpdateCatalogCategory(ctx, db, child.ID, crossInput, "idem-tree-cross-parent-"+suffix, postgres.HashCatalogCategoryUpdateRequest(child.ID, crossInput, crossReason), closureAudit("corr-tree-cross-parent-"+suffix, crossReason)); !errors.Is(err, postgres.ErrCatalogCategoryNotFound) {
			t.Fatalf("cross-vertical parent move error=%v, want rejection", err)
		}

		moveInput := postgres.UpdateCatalogCategoryInput{ParentCategoryID: rootB.ID, NameAr: child.NameAr, NameEn: child.NameEn, Active: true, ExpectedVersion: 1}
		moveReason := "Move coffee category under hot drinks"
		moved, replayed, err := postgres.UpdateCatalogCategory(ctx, db, child.ID, moveInput, "idem-tree-move-"+suffix, postgres.HashCatalogCategoryUpdateRequest(child.ID, moveInput, moveReason), closureAudit("corr-tree-move-"+suffix, moveReason))
		if err != nil || replayed || moved.Version != 2 || moved.ParentCategoryID != rootB.ID {
			t.Fatalf("move child to a new parent=%+v replayed=%t error=%v", moved, replayed, err)
		}
		registryRead, err := postgres.ReadCatalogCategoryForRegistry(ctx, db, child.ID)
		if err != nil || registryRead.PathAr != rootB.NameAr+" / "+child.NameAr || registryRead.PathEn != rootB.NameEn+" / "+child.NameEn {
			t.Fatalf("moved category path readback=%+v error=%v", registryRead, err)
		}

		deactivateParent := postgres.UpdateCatalogCategoryInput{ParentCategoryID: "", NameAr: rootB.NameAr, NameEn: rootB.NameEn, Active: false, ExpectedVersion: 1}
		deactivateParentReason := "Deactivate parent with child"
		if _, _, err := postgres.UpdateCatalogCategory(ctx, db, rootB.ID, deactivateParent, "idem-tree-parent-active-child-"+suffix, postgres.HashCatalogCategoryUpdateRequest(rootB.ID, deactivateParent, deactivateParentReason), closureAudit("corr-tree-parent-active-child-"+suffix, deactivateParentReason)); !errors.Is(err, postgres.ErrCatalogCategoryHasActiveChildren) {
			t.Fatalf("deactivate parent with active child error=%v, want child guard", err)
		}
		deactivateChild := moveInput
		deactivateChild.Active = false
		deactivateChild.ExpectedVersion = 2
		deactivateChildReason := "Deactivate coffee category"
		deactivatedChild, _, err := postgres.UpdateCatalogCategory(ctx, db, child.ID, deactivateChild, "idem-tree-deactivate-child-"+suffix, postgres.HashCatalogCategoryUpdateRequest(child.ID, deactivateChild, deactivateChildReason), closureAudit("corr-tree-deactivate-child-"+suffix, deactivateChildReason))
		if err != nil || deactivatedChild.Active || deactivatedChild.Version != 3 {
			t.Fatalf("deactivate child=%+v error=%v", deactivatedChild, err)
		}
		deactivatedParent, _, err := postgres.UpdateCatalogCategory(ctx, db, rootB.ID, deactivateParent, "idem-tree-deactivate-parent-"+suffix, postgres.HashCatalogCategoryUpdateRequest(rootB.ID, deactivateParent, deactivateParentReason), closureAudit("corr-tree-deactivate-parent-"+suffix, deactivateParentReason))
		if err != nil || deactivatedParent.Active || deactivatedParent.Version != 2 {
			t.Fatalf("deactivate empty parent=%+v error=%v", deactivatedParent, err)
		}
		reactivateChild := moveInput
		reactivateChild.ExpectedVersion = 3
		reactivateChildReason := "Reactivate under inactive parent"
		if _, _, err := postgres.UpdateCatalogCategory(ctx, db, child.ID, reactivateChild, "idem-tree-reactivate-child-blocked-"+suffix, postgres.HashCatalogCategoryUpdateRequest(child.ID, reactivateChild, reactivateChildReason), closureAudit("corr-tree-reactivate-child-blocked-"+suffix, reactivateChildReason)); !errors.Is(err, postgres.ErrCatalogCategoryParentInactive) {
			t.Fatalf("reactivate child under inactive parent error=%v, want parent guard", err)
		}
		reactivateParent := deactivateParent
		reactivateParent.Active = true
		reactivateParent.ExpectedVersion = 2
		reactivateParentReason := "Reactivate hot drinks category"
		reactivatedParent, _, err := postgres.UpdateCatalogCategory(ctx, db, rootB.ID, reactivateParent, "idem-tree-reactivate-parent-"+suffix, postgres.HashCatalogCategoryUpdateRequest(rootB.ID, reactivateParent, reactivateParentReason), closureAudit("corr-tree-reactivate-parent-"+suffix, reactivateParentReason))
		if err != nil || !reactivatedParent.Active || reactivatedParent.Version != 3 {
			t.Fatalf("reactivate parent=%+v error=%v", reactivatedParent, err)
		}
		reactivatedChild, _, err := postgres.UpdateCatalogCategory(ctx, db, child.ID, reactivateChild, "idem-tree-reactivate-child-"+suffix, postgres.HashCatalogCategoryUpdateRequest(child.ID, reactivateChild, reactivateChildReason), closureAudit("corr-tree-reactivate-child-"+suffix, reactivateChildReason))
		if err != nil || !reactivatedChild.Active || reactivatedChild.Version != 4 {
			t.Fatalf("reactivate child=%+v error=%v", reactivatedChild, err)
		}

		storeType := postgres.CommercialStoreTypeRecord{ID: "tree-store-type-" + suffix, VerticalID: vertical.ID, NameAr: "مقهى", NameEn: "Cafe", Active: true}
		storeTypeReason := "Create active cafe store type"
		if _, err := postgres.CreateCommercialStoreType(ctx, db, storeType, "idem-tree-store-type-"+suffix, postgres.HashCommercialStoreTypeCreateRequest(storeType, storeTypeReason), closureAudit("corr-tree-store-type-"+suffix, storeTypeReason)); err != nil {
			t.Fatalf("create active store type before vertical disable: %v", err)
		}
		deactivateVertical := postgres.UpdateCommerceVerticalInput{NameAr: vertical.NameAr, NameEn: vertical.NameEn, Active: false, ExpectedVersion: 1}
		deactivateVerticalReason := "Disable test commerce vertical"
		inactiveVertical, err := postgres.UpdateCommerceVertical(ctx, db, vertical.ID, deactivateVertical, "idem-tree-disable-vertical-"+suffix, postgres.HashCatalogVerticalUpdateRequest(vertical.ID, deactivateVertical, deactivateVerticalReason), closureAudit("corr-tree-disable-vertical-"+suffix, deactivateVerticalReason))
		if err != nil || inactiveVertical.Vertical.Active || inactiveVertical.Vertical.Version != 2 {
			t.Fatalf("disable commerce vertical=%+v error=%v", inactiveVertical, err)
		}
		activeTypes, err := postgres.ListCommercialStoreTypes(ctx, db, vertical.ID, true)
		if err != nil || len(activeTypes) != 0 {
			t.Fatalf("active store type read with vertical disabled=%+v error=%v", activeTypes, err)
		}
		if _, err := postgres.ReadActiveCommercialStoreType(ctx, db, storeType.ID); !errors.Is(err, postgres.ErrCommercialStoreTypeNotFound) {
			t.Fatalf("active store type read after vertical disable error=%v", err)
		}
		if _, err := postgres.CreateCatalogCategory(ctx, db, postgres.CatalogCategoryRecord{ID: "tree-disabled-category-" + suffix, VerticalID: vertical.ID, NameAr: "جديدة", NameEn: "New", Active: true}, "idem-tree-disabled-category-"+suffix, "disabled-category-request-hash", closureAudit("corr-tree-disabled-category-"+suffix, "Create category under disabled vertical")); !errors.Is(err, postgres.ErrCatalogVerticalNotFound) {
			t.Fatalf("category create under disabled vertical error=%v", err)
		}
		if _, err := postgres.CreateCommercialStoreType(ctx, db, postgres.CommercialStoreTypeRecord{ID: "tree-disabled-type-" + suffix, VerticalID: vertical.ID, NameAr: "نوع جديد", NameEn: "New Type", Active: true}, "idem-tree-disabled-type-"+suffix, "disabled-type-request-hash", closureAudit("corr-tree-disabled-type-"+suffix, "Create type under disabled vertical")); !errors.Is(err, postgres.ErrCatalogVerticalNotFound) {
			t.Fatalf("store type create under disabled vertical error=%v", err)
		}
		inactiveCategoryUpdate := postgres.UpdateCatalogCategoryInput{ParentCategoryID: rootB.ID, NameAr: child.NameAr, NameEn: child.NameEn, Active: true, ExpectedVersion: 4}
		inactiveCategoryReason := "Move category while vertical disabled"
		if _, _, err := postgres.UpdateCatalogCategory(ctx, db, child.ID, inactiveCategoryUpdate, "idem-tree-disabled-category-update-"+suffix, postgres.HashCatalogCategoryUpdateRequest(child.ID, inactiveCategoryUpdate, inactiveCategoryReason), closureAudit("corr-tree-disabled-category-update-"+suffix, inactiveCategoryReason)); !errors.Is(err, postgres.ErrCatalogVerticalNotFound) {
			t.Fatalf("category update under disabled vertical error=%v", err)
		}
		preservedCategory, err := postgres.ReadCatalogCategory(ctx, db, child.ID)
		if err != nil || !preservedCategory.Active || preservedCategory.ParentCategoryID != rootB.ID || preservedCategory.Version != 4 {
			t.Fatalf("vertical disable changed durable category state: %+v error=%v", preservedCategory, err)
		}

		reactivateVertical := deactivateVertical
		reactivateVertical.Active = true
		reactivateVertical.ExpectedVersion = 2
		reactivateVerticalReason := "Reactivate test commerce vertical"
		if result, err := postgres.UpdateCommerceVertical(ctx, db, vertical.ID, reactivateVertical, "idem-tree-reactivate-vertical-"+suffix, postgres.HashCatalogVerticalUpdateRequest(vertical.ID, reactivateVertical, reactivateVerticalReason), closureAudit("corr-tree-reactivate-vertical-"+suffix, reactivateVerticalReason)); err != nil || !result.Vertical.Active || result.Vertical.Version != 3 {
			t.Fatalf("reactivate commerce vertical=%+v error=%v", result, err)
		}
		activeType, err := postgres.ReadActiveCommercialStoreType(ctx, db, storeType.ID)
		if err != nil || !activeType.Active || activeType.Version != 1 {
			t.Fatalf("store type survived vertical reactivation=%+v error=%v", activeType, err)
		}
		preservedCategory, err = postgres.ReadCatalogCategory(ctx, db, child.ID)
		if err != nil || !preservedCategory.Active || preservedCategory.Version != 4 {
			t.Fatalf("category survived vertical reactivation=%+v error=%v", preservedCategory, err)
		}
	})
}

func createClosureVertical(t *testing.T, ctx context.Context, db *sql.DB, prefix, suffix string) postgres.CommerceVerticalRecord {
	t.Helper()
	item := postgres.CommerceVerticalRecord{ID: prefix + suffix, NameAr: "مجال اختبار " + prefix + suffix, NameEn: "Test Vertical " + prefix + suffix, Active: true}
	reason := "Create catalog tree test vertical"
	created, err := postgres.CreateCommerceVertical(ctx, db, item, "idem-"+prefix+suffix, postgres.HashCatalogVerticalCreateRequest(item, reason), closureAudit("corr-"+prefix+suffix, reason))
	if err != nil {
		t.Fatalf("create commerce vertical: %v", err)
	}
	return created.Vertical
}

func createClosureCategory(t *testing.T, ctx context.Context, db *sql.DB, verticalID, id, nameAr, nameEn, parentID, suffix string) postgres.CatalogCategoryRecord {
	t.Helper()
	item := postgres.CatalogCategoryRecord{ID: id, VerticalID: verticalID, ParentCategoryID: parentID, NameAr: nameAr, NameEn: nameEn, Active: true}
	reason := "Create category in tree lifecycle test"
	created, err := postgres.CreateCatalogCategory(ctx, db, item, "idem-"+id, postgres.HashCatalogCategoryCreateRequest(item, reason), closureAudit("corr-"+id+"-"+suffix, reason))
	if err != nil {
		t.Fatalf("create category %s: %v", id, err)
	}
	return created
}

func closureAudit(correlationID, reason string) postgres.CatalogRegistryAuditInput {
	return postgres.CatalogRegistryAuditInput{ActingActorID: testOperatorActorID, CorrelationID: correlationID, Reason: reason}
}
