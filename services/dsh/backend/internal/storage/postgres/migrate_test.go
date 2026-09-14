package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

const (
	testPartnerActorID  = "act_partner_dsh_v4"
	testOtherPartnerID  = "act_other_partner_dsh_v4"
	testOperatorActorID = "act_operator_dsh_v4"
)

func TestFreshJoiningAndAssortmentIntegrity(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh DSH proof")
	}

	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if len(records) != postgres.SchemaVersion || len(migrationSQL) != postgres.SchemaVersion || records[2].Name != "003_joining_cases_and_catalog.sql" || records[3].Name != "004_central_product_store_assortment_cutover.sql" || records[4].Name != "005_joining_case_partner_correction.sql" || records[5].Name != "006_joining_case_correct_and_resubmit.sql" || records[6].Name != "007_location_core.sql" || records[7].Name != "008_location_core_corrective_boundaries.sql" {
			t.Fatalf("unexpected DSH migration graph: records=%d sql=%d third=%s fourth=%s fifth=%s sixth=%s seventh=%s eighth=%s", len(records), len(migrationSQL), records[2].Name, records[3].Name, records[4].Name, records[5].Name, records[6].Name, records[7].Name)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("apply fresh DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify fresh DSH schema: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("rerun DSH migrations with matching checksums: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify rerun DSH schema: %v", err)
		}
		for _, table := range []string{"partner_bootstrap_idempotency", "partner_bootstrap_audit"} {
			var absent bool
			if err := db.QueryRowContext(ctx, "SELECT to_regclass($1) IS NULL", "dsh."+table).Scan(&absent); err != nil || !absent {
				t.Fatalf("legacy DSH table remains after cutover: %s err=%v", table, err)
			}
		}

		created, err := postgres.CreateJoiningCase(ctx, db, "idem-joining-create-v3", postgres.HashJoiningCaseRequest("+96777000001", "Cafe V3", "Cafe Store"), testOperatorActorID, "corr-joining-create-v3", "+96777000001", "Cafe V3", "Cafe Store")
		if err != nil || created.Case.State != "draft" || created.Case.Version != 1 || created.Replayed {
			t.Fatalf("create joining case failed: %+v err=%v", created, err)
		}
		queued, err := postgres.ListJoiningCases(ctx, db, "draft", 50, "")
		if err != nil || len(queued.Cases) != 1 || queued.Cases[0].ID != created.Case.ID || queued.Cases[0].State != "draft" || queued.NextCursor != "" {
			t.Fatalf("joining queue read failed: %+v err=%v", queued, err)
		}
		replay, err := postgres.CreateJoiningCase(ctx, db, "idem-joining-create-v3", postgres.HashJoiningCaseRequest("+96777000001", "Cafe V3", "Cafe Store"), testOperatorActorID, "corr-joining-replay-v3", "+96777000001", "Cafe V3", "Cafe Store")
		if err != nil || !replay.Replayed || replay.Case.ID != created.Case.ID {
			t.Fatalf("joining create replay failed: %+v err=%v", replay, err)
		}
		if _, err := postgres.CreateJoiningCase(ctx, db, "idem-joining-create-v3", postgres.HashJoiningCaseRequest("+96777000001", "Cafe Changed", "Cafe Store"), testOperatorActorID, "corr-joining-conflict-v3", "+96777000001", "Cafe Changed", "Cafe Store"); !errors.Is(err, postgres.ErrJoiningCaseIdempotency) {
			t.Fatalf("expected joining idempotency conflict, got %v", err)
		}

		submitted, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, testPartnerActorID, 1, "idem-joining-submit-v3", postgres.HashJoiningCaseSubmit(created.Case.ID, testPartnerActorID, 1), testOperatorActorID, "corr-joining-submit-v3")
		if err != nil || submitted.Case.State != "submitted" || submitted.Case.Version != 2 || submitted.Case.PartnerActorID != testPartnerActorID {
			t.Fatalf("submit joining case failed: %+v err=%v", submitted, err)
		}
		if _, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, testPartnerActorID, 1, "idem-joining-stale-v3", postgres.HashJoiningCaseSubmit(created.Case.ID, testPartnerActorID, 1), testOperatorActorID, "corr-joining-stale-v3"); !errors.Is(err, postgres.ErrJoiningCaseVersion) {
			t.Fatalf("expected joining version conflict, got %v", err)
		}

		correction, err := postgres.ReviewJoiningCase(ctx, db, created.Case.ID, "needs_correction", "أكمل عنوان المتجر", 2, "idem-joining-correction-v3", postgres.HashJoiningCaseReview(created.Case.ID, "needs_correction", "أكمل عنوان المتجر", 2), testOperatorActorID, "corr-joining-correction-v3")
		if err != nil || correction.Case.State != "needs_correction" || correction.Case.Version != 3 || correction.Case.CorrectionReason != "أكمل عنوان المتجر" || correction.Case.Store != nil {
			t.Fatalf("joining correction failed: %+v err=%v", correction, err)
		}
		if _, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, testOtherPartnerID, 3, "idem-joining-rebind-v3", postgres.HashJoiningCaseSubmit(created.Case.ID, testOtherPartnerID, 3), testOperatorActorID, "corr-joining-rebind-v3"); !errors.Is(err, postgres.ErrJoiningCaseState) {
			t.Fatalf("expected operator resubmission state rejection, got %v", err)
		}
		if _, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, testOtherPartnerID, "Nope", "Nope Store", 3, "idem-joining-wrong-partner-v6", postgres.HashJoiningCaseCorrectAndResubmit(created.Case.ID, testOtherPartnerID, "Nope", "Nope Store", 3), "corr-joining-wrong-partner-v6"); !errors.Is(err, postgres.ErrJoiningCasePartnerAccess) {
			t.Fatalf("expected wrong partner rejection, got %v", err)
		}
		resubmitted, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, testPartnerActorID, "Cafe Corrected", "Cafe Corrected Store", 3, "idem-joining-correct-resubmit-v6", postgres.HashJoiningCaseCorrectAndResubmit(created.Case.ID, testPartnerActorID, "Cafe Corrected", "Cafe Corrected Store", 3), "corr-joining-correct-resubmit-v6")
		if err != nil || resubmitted.Case.State != "submitted" || resubmitted.Case.Version != 4 || resubmitted.Case.BusinessName != "Cafe Corrected" || resubmitted.Case.FirstStoreName != "Cafe Corrected Store" || resubmitted.Case.CorrectionReason != "" {
			t.Fatalf("joining atomic correction and resubmission failed: %+v err=%v", resubmitted, err)
		}
		resubmitReplay, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, testPartnerActorID, "Cafe Corrected", "Cafe Corrected Store", 3, "idem-joining-correct-resubmit-v6", postgres.HashJoiningCaseCorrectAndResubmit(created.Case.ID, testPartnerActorID, "Cafe Corrected", "Cafe Corrected Store", 3), "corr-joining-correct-resubmit-replay-v6")
		if err != nil || !resubmitReplay.Replayed || resubmitReplay.Case.Version != 4 {
			t.Fatalf("joining atomic correction replay failed: %+v err=%v", resubmitReplay, err)
		}
		if _, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, testPartnerActorID, "Different", "Different Store", 3, "idem-joining-correct-resubmit-v6", postgres.HashJoiningCaseCorrectAndResubmit(created.Case.ID, testPartnerActorID, "Different", "Different Store", 3), "corr-joining-correct-resubmit-conflict-v6"); !errors.Is(err, postgres.ErrJoiningCaseIdempotency) {
			t.Fatalf("expected atomic correction idempotency conflict, got %v", err)
		}
		if _, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, testPartnerActorID, "Different", "Different Store", 4, "idem-joining-correct-resubmit-invalid-state-v6", postgres.HashJoiningCaseCorrectAndResubmit(created.Case.ID, testPartnerActorID, "Different", "Different Store", 4), "corr-joining-correct-resubmit-invalid-state-v6"); !errors.Is(err, postgres.ErrJoiningCaseState) {
			t.Fatalf("expected atomic correction invalid-state rejection, got %v", err)
		}
		concurrent, err := postgres.CreateJoiningCase(ctx, db, "idem-joining-concurrent-create-v6", postgres.HashJoiningCaseRequest("+96777000002", "Concurrent Cafe", "Concurrent Store"), testOperatorActorID, "corr-joining-concurrent-create-v6", "+96777000002", "Concurrent Cafe", "Concurrent Store")
		if err != nil {
			t.Fatalf("create concurrent joining case: %v", err)
		}
		concurrentSubmit, err := postgres.SubmitJoiningCase(ctx, db, concurrent.Case.ID, testOtherPartnerID, 1, "idem-joining-concurrent-submit-v6", postgres.HashJoiningCaseSubmit(concurrent.Case.ID, testOtherPartnerID, 1), testOperatorActorID, "corr-joining-concurrent-submit-v6")
		if err != nil {
			t.Fatalf("submit concurrent joining case: %v", err)
		}
		concurrentCorrection, err := postgres.ReviewJoiningCase(ctx, db, concurrent.Case.ID, "needs_correction", "أكمل مستند النشاط", 2, "idem-joining-concurrent-review-v6", postgres.HashJoiningCaseReview(concurrent.Case.ID, "needs_correction", "أكمل مستند النشاط", 2), testOperatorActorID, "corr-joining-concurrent-review-v6")
		if err != nil || concurrentSubmit.Case.State != "submitted" || concurrentCorrection.Case.State != "needs_correction" {
			t.Fatalf("prepare concurrent joining case failed: %+v %+v err=%v", concurrentSubmit, concurrentCorrection, err)
		}
		var wait sync.WaitGroup
		results := make(chan error, 2)
		for i, name := range []string{"Concurrent A", "Concurrent B"} {
			wait.Add(1)
			go func(index int, business string) {
				defer wait.Done()
				_, callErr := postgres.CorrectAndResubmitJoiningCase(ctx, db, concurrent.Case.ID, testOtherPartnerID, business, business+" Store", 3, fmt.Sprintf("idem-joining-concurrent-correct-v6-%d", index), postgres.HashJoiningCaseCorrectAndResubmit(concurrent.Case.ID, testOtherPartnerID, business, business+" Store", 3), fmt.Sprintf("corr-joining-concurrent-correct-v6-%d", index))
				results <- callErr
			}(i, name)
		}
		wait.Wait()
		close(results)
		var concurrentSuccess, concurrentVersionConflict int
		for callErr := range results {
			if callErr == nil {
				concurrentSuccess++
			} else if errors.Is(callErr, postgres.ErrJoiningCaseVersion) {
				concurrentVersionConflict++
			}
		}
		if concurrentSuccess != 1 || concurrentVersionConflict != 1 {
			t.Fatalf("atomic correction concurrency was not serialized: success=%d version_conflict=%d", concurrentSuccess, concurrentVersionConflict)
		}
		firstPage, err := postgres.ListJoiningCases(ctx, db, "", 1, "")
		if err != nil || len(firstPage.Cases) != 1 || firstPage.NextCursor == "" {
			t.Fatalf("joining queue first page failed: %+v err=%v", firstPage, err)
		}
		secondPage, err := postgres.ListJoiningCases(ctx, db, "", 1, firstPage.NextCursor)
		if err != nil || len(secondPage.Cases) != 1 || secondPage.Cases[0].ID == firstPage.Cases[0].ID || secondPage.NextCursor != "" {
			t.Fatalf("joining queue keyset page failed: %+v err=%v", secondPage, err)
		}
		if _, err := postgres.ListJoiningCases(ctx, db, "", 1, "not-a-valid-cursor"); !errors.Is(err, postgres.ErrJoiningCaseInvalidCursor) {
			t.Fatalf("expected invalid joining queue cursor rejection, got %v", err)
		}
		if _, err := postgres.ListJoiningCases(ctx, db, "", 51, ""); !errors.Is(err, postgres.ErrJoiningCaseInvalidLimit) {
			t.Fatalf("expected invalid joining queue limit rejection, got %v", err)
		}
		if _, err := postgres.ReviewJoiningCase(ctx, db, created.Case.ID, "approved", "", 4, "idem-joining-self-review-v6", postgres.HashJoiningCaseReview(created.Case.ID, "approved", "", 4), testPartnerActorID, "corr-joining-self-review-v6"); !errors.Is(err, postgres.ErrJoiningCaseSelfReview) {
			t.Fatalf("expected joining self-review rejection, got %v", err)
		}
		approved, err := postgres.ReviewJoiningCase(ctx, db, created.Case.ID, "approved", "", 4, "idem-joining-approve-v6", postgres.HashJoiningCaseReview(created.Case.ID, "approved", "", 4), testOperatorActorID, "corr-joining-approve-v6")
		if err != nil || approved.Case.State != "approved" || approved.Case.Version != 5 || approved.Case.Store == nil || approved.Case.Store.PartnerActorID != testPartnerActorID || approved.Case.Store.Name != "Cafe Corrected Store" {
			t.Fatalf("joining approval failed: %+v err=%v", approved, err)
		}

		productInput := postgres.CentralProductInput{CanonicalName: "قهوة عربية", Brand: stringPtr("BThwani"), Barcode: stringPtr("6281000000001"), CanonicalImageURL: stringPtr("https://example.com/coffee.jpg"), SellUnit: "piece"}
		product, err := postgres.CreateCentralProduct(ctx, db, productInput, "idem-product-create-v4", postgres.HashCentralProductCreateRequest(productInput), testOperatorActorID, "corr-product-create-v4")
		if err != nil || !product.Product.Active || product.Product.Version != 1 || product.Replayed {
			t.Fatalf("central Product create failed: %+v err=%v", product, err)
		}
		productReplay, err := postgres.CreateCentralProduct(ctx, db, productInput, "idem-product-create-v4", postgres.HashCentralProductCreateRequest(productInput), testOperatorActorID, "corr-product-replay-v4")
		if err != nil || !productReplay.Replayed || productReplay.Product.ID != product.Product.ID {
			t.Fatalf("central Product create replay failed: %+v err=%v", productReplay, err)
		}
		if _, err := postgres.CreateCentralProduct(ctx, db, postgres.CentralProductInput{CanonicalName: "شاي", SellUnit: "piece"}, "idem-product-create-v4", postgres.HashCentralProductCreateRequest(postgres.CentralProductInput{CanonicalName: "شاي", SellUnit: "piece"}), testOperatorActorID, "corr-product-conflict-v4"); !errors.Is(err, postgres.ErrCentralProductIdempotency) {
			t.Fatalf("expected central Product idempotency conflict, got %v", err)
		}
		changedProductInput := postgres.CentralProductUpdateInput{CanonicalName: "قهوة عربية محمصة", Brand: productInput.Brand, Barcode: productInput.Barcode, CanonicalImageURL: stringPtr("https://example.com/coffee-roasted.jpg"), Active: true}
		if _, err := postgres.UpdateCentralProduct(ctx, db, product.Product.ID, changedProductInput, 9, "idem-product-stale-v4", postgres.HashCentralProductUpdateRequest(product.Product.ID, changedProductInput, 9), testOperatorActorID, "corr-product-stale-v4"); !errors.Is(err, postgres.ErrCentralProductVersion) {
			t.Fatalf("expected central Product version conflict, got %v", err)
		}
		updatedProduct, err := postgres.UpdateCentralProduct(ctx, db, product.Product.ID, changedProductInput, 1, "idem-product-update-v4", postgres.HashCentralProductUpdateRequest(product.Product.ID, changedProductInput, 1), testOperatorActorID, "corr-product-update-v4")
		if err != nil || updatedProduct.Product.CanonicalName != "قهوة عربية محمصة" || updatedProduct.Product.Version != 2 {
			t.Fatalf("central Product update failed: %+v err=%v", updatedProduct, err)
		}

		assortment, err := postgres.CreateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, "idem-assortment-create-v4", postgres.HashStoreAssortmentCreateRequest(approved.Case.Store.ID, product.Product.ID, 1250), testPartnerActorID, "corr-assortment-create-v4")
		if err != nil || assortment.Assortment.PublicationState != "draft" || assortment.Assortment.Version != 1 || assortment.Replayed {
			t.Fatalf("Store Assortment create failed: %+v err=%v", assortment, err)
		}
		assortmentReplay, err := postgres.CreateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, "idem-assortment-create-v4", postgres.HashStoreAssortmentCreateRequest(approved.Case.Store.ID, product.Product.ID, 1250), testPartnerActorID, "corr-assortment-replay-v4")
		if err != nil || !assortmentReplay.Replayed || assortmentReplay.Assortment.ProductID != product.Product.ID {
			t.Fatalf("Store Assortment create replay failed: %+v err=%v", assortmentReplay, err)
		}
		if _, err := postgres.CreateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1300, "idem-assortment-create-v4", postgres.HashStoreAssortmentCreateRequest(approved.Case.Store.ID, product.Product.ID, 1300), testPartnerActorID, "corr-assortment-conflict-v4"); !errors.Is(err, postgres.ErrStoreAssortmentIdempotency) {
			t.Fatalf("expected Store Assortment idempotency conflict, got %v", err)
		}
		if _, err := postgres.UpdateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 9, "idem-assortment-stale-v4", postgres.HashStoreAssortmentUpdateRequest(approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 9), testPartnerActorID, "corr-assortment-stale-v4"); !errors.Is(err, postgres.ErrStoreAssortmentVersion) {
			t.Fatalf("expected Store Assortment version conflict, got %v", err)
		}
		publishedAssortment, err := postgres.UpdateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 1, "idem-assortment-publish-v4", postgres.HashStoreAssortmentUpdateRequest(approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 1), testPartnerActorID, "corr-assortment-publish-v4")
		if err != nil || publishedAssortment.Assortment.PublicationState != "published" || publishedAssortment.Assortment.Version != 2 {
			t.Fatalf("Store Assortment publish failed: %+v err=%v", publishedAssortment, err)
		}
		if _, err := postgres.ReadPublishedStore(ctx, db, approved.Case.Store.ID); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("unpublished Store became public before Store publication: %v", err)
		}

		store, err := postgres.SetStorePublication(ctx, db, approved.Case.Store.ID, "published", 1, "idem-store-publish-v3", postgres.HashStorePublicationRequest(approved.Case.Store.ID, "published", 1), testOperatorActorID, "corr-store-publish-v3")
		if err != nil || store.Store.PublicationState != "published" || store.Store.Version != 2 {
			t.Fatalf("Store publication failed: %+v err=%v", store, err)
		}
		publicStore, err := postgres.ReadPublishedStore(ctx, db, approved.Case.Store.ID)
		if err != nil || len(publicStore.Assortments) != 1 || publicStore.Assortments[0].ProductID != product.Product.ID || publicStore.Assortments[0].Product.CanonicalName != "قهوة عربية محمصة" {
			t.Fatalf("public Store Assortment readback failed: %+v err=%v", publicStore, err)
		}
		if _, err := postgres.SetStorePublication(ctx, db, approved.Case.Store.ID, "hidden", 1, "idem-store-stale-v4", postgres.HashStorePublicationRequest(approved.Case.Store.ID, "hidden", 1), testOperatorActorID, "corr-store-stale-v4"); !errors.Is(err, postgres.ErrPublicationVersionConflict) {
			t.Fatalf("expected Store version conflict, got %v", err)
		}

		disabledProductInput := postgres.CentralProductUpdateInput{CanonicalName: changedProductInput.CanonicalName, Brand: changedProductInput.Brand, Barcode: changedProductInput.Barcode, CanonicalImageURL: changedProductInput.CanonicalImageURL, Active: false}
		if _, err := postgres.UpdateCentralProduct(ctx, db, product.Product.ID, disabledProductInput, 2, "idem-product-disable-v4", postgres.HashCentralProductUpdateRequest(product.Product.ID, disabledProductInput, 2), testOperatorActorID, "corr-product-disable-v4"); err != nil {
			t.Fatalf("disable central Product failed: %v", err)
		}
		if _, err := postgres.UpdateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, true, "hidden", 2, "idem-assortment-hide-v4", postgres.HashStoreAssortmentUpdateRequest(approved.Case.Store.ID, product.Product.ID, 1250, true, "hidden", 2), testPartnerActorID, "corr-assortment-hide-v4"); err != nil {
			t.Fatalf("hide Store Assortment failed: %v", err)
		}
		if _, err := postgres.UpdateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 3, "idem-assortment-disabled-v4", postgres.HashStoreAssortmentUpdateRequest(approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 3), testPartnerActorID, "corr-assortment-disabled-v4"); !errors.Is(err, postgres.ErrStoreAssortmentProductDisabled) {
			t.Fatalf("expected disabled central Product publication rejection, got %v", err)
		}
		if _, err := postgres.ReadPublishedStore(ctx, db, approved.Case.Store.ID); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("disabled central Product remained public: %v", err)
		}
		if _, err := postgres.UpdateCentralProduct(ctx, db, product.Product.ID, changedProductInput, 3, "idem-product-enable-v4", postgres.HashCentralProductUpdateRequest(product.Product.ID, changedProductInput, 3), testOperatorActorID, "corr-product-enable-v4"); err != nil {
			t.Fatalf("re-enable central Product failed: %v", err)
		}
		if _, err := postgres.UpdateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 3, "idem-assortment-republish-v4", postgres.HashStoreAssortmentUpdateRequest(approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 3), testPartnerActorID, "corr-assortment-republish-v4"); err != nil {
			t.Fatalf("republish Store Assortment failed: %v", err)
		}
		unavailable, err := postgres.UpdateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, false, "published", 4, "idem-assortment-unavailable-v4", postgres.HashStoreAssortmentUpdateRequest(approved.Case.Store.ID, product.Product.ID, 1250, false, "published", 4), testPartnerActorID, "corr-assortment-unavailable-v4")
		if err != nil || unavailable.Assortment.Version != 5 {
			t.Fatalf("Store Assortment availability update failed: %+v err=%v", unavailable, err)
		}
		if _, err := postgres.ReadPublishedStore(ctx, db, approved.Case.Store.ID); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("unavailable Store Assortment remained public: %v", err)
		}
		if _, err := postgres.UpdateStoreAssortment(ctx, db, approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 5, "idem-assortment-available-v4", postgres.HashStoreAssortmentUpdateRequest(approved.Case.Store.ID, product.Product.ID, 1250, true, "published", 5), testPartnerActorID, "corr-assortment-available-v4"); err != nil {
			t.Fatalf("restore Store Assortment availability failed: %v", err)
		}
		hidden, err := postgres.SetStorePublication(ctx, db, approved.Case.Store.ID, "hidden", 2, "idem-store-hide-v4", postgres.HashStorePublicationRequest(approved.Case.Store.ID, "hidden", 2), testOperatorActorID, "corr-store-hide-v4")
		if err != nil || hidden.Store.PublicationState != "hidden" || hidden.Store.Version != 3 {
			t.Fatalf("Store hide failed: %+v err=%v", hidden, err)
		}
		if _, err := postgres.ReadPublishedStore(ctx, db, approved.Case.Store.ID); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("hidden Store remained public: %v", err)
		}

		var stores, cases, joiningAudit, products, productAudit, assortments, assortmentAudit, history int
		for _, check := range []struct {
			name  string
			query string
			out   *int
		}{
			{"stores", "SELECT count(*) FROM dsh.stores", &stores},
			{"joining cases", "SELECT count(*) FROM dsh.joining_cases", &cases},
			{"joining audit", "SELECT count(*) FROM dsh.joining_case_audit", &joiningAudit},
			{"central Products", "SELECT count(*) FROM dsh.central_products", &products},
			{"central Product audit", "SELECT count(*) FROM dsh.central_product_audit", &productAudit},
			{"Store Assortments", "SELECT count(*) FROM dsh.store_assortments", &assortments},
			{"Store Assortment audit", "SELECT count(*) FROM dsh.store_assortment_audit", &assortmentAudit},
			{"migration history", "SELECT count(*) FROM dsh.schema_migrations", &history},
		} {
			if err := db.QueryRowContext(ctx, check.query).Scan(check.out); err != nil {
				t.Fatalf("read %s: %v", check.name, err)
			}
		}
		if stores != 1 || cases != 2 || joiningAudit != 9 || products != 1 || productAudit != 4 || assortments != 1 || assortmentAudit != 6 || history != postgres.SchemaVersion {
			t.Fatalf("unexpected central Product / Store Assortment readback: stores=%d cases=%d joiningAudit=%d products=%d productAudit=%d assortments=%d assortmentAudit=%d history=%d", stores, cases, joiningAudit, products, productAudit, assortments, assortmentAudit, history)
		}
	})
}

func stringPtr(value string) *string {
	return &value
}

func withFreshDatabase(t *testing.T, rootDB *sql.DB, databaseURL string, test func(context.Context, *sql.DB, []postgres.MigrationRecord, []string)) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	databaseName := fmt.Sprintf("dsh_v4_test_%d", time.Now().UnixNano())
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
		t.Fatalf("parse DSH database URL: %v", err)
	}
	parsedURL.Path = "/" + databaseName
	testDB, err := sql.Open("postgres", parsedURL.String())
	if err != nil {
		t.Fatalf("open isolated DSH database: %v", err)
	}
	t.Cleanup(func() { _ = testDB.Close() })
	if err := testDB.PingContext(ctx); err != nil {
		t.Fatalf("isolated DSH database is not reachable: %v", err)
	}
	migrationDirectory := filepath.Join("..", "..", "..", "..", "database", "migrations")
	records, migrationSQL, err := postgres.LoadMigrations(migrationDirectory)
	if err != nil {
		t.Fatalf("load DSH canonical migrations from %s: %v", migrationDirectory, err)
	}
	test(ctx, testDB, records, migrationSQL)
}
