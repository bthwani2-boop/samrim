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
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

const (
	testPartnerActorID  = "act_partner_dsh_v3"
	testOtherPartnerID  = "act_other_partner_dsh_v3"
	testOperatorActorID = "act_operator_dsh_v3"
)

func TestFreshJoiningAndCatalogIntegrity(t *testing.T) {
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
		if len(records) != postgres.SchemaVersion || len(migrationSQL) != postgres.SchemaVersion || records[2].Name != "003_joining_cases_and_catalog.sql" {
			t.Fatalf("unexpected DSH migration graph: records=%d sql=%d third=%s", len(records), len(migrationSQL), records[2].Name)
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
		if _, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, testOtherPartnerID, 3, "idem-joining-rebind-v3", postgres.HashJoiningCaseSubmit(created.Case.ID, testOtherPartnerID, 3), testOperatorActorID, "corr-joining-rebind-v3"); !errors.Is(err, postgres.ErrJoiningCaseRebind) {
			t.Fatalf("expected joining actor rebind rejection, got %v", err)
		}
		resubmitted, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, testPartnerActorID, 3, "idem-joining-resubmit-v3", postgres.HashJoiningCaseSubmit(created.Case.ID, testPartnerActorID, 3), testOperatorActorID, "corr-joining-resubmit-v3")
		if err != nil || resubmitted.Case.State != "submitted" || resubmitted.Case.Version != 4 {
			t.Fatalf("joining resubmission failed: %+v err=%v", resubmitted, err)
		}
		if _, err := postgres.ReviewJoiningCase(ctx, db, created.Case.ID, "approved", "", 4, "idem-joining-self-review-v3", postgres.HashJoiningCaseReview(created.Case.ID, "approved", "", 4), testPartnerActorID, "corr-joining-self-review-v3"); !errors.Is(err, postgres.ErrJoiningCaseSelfReview) {
			t.Fatalf("expected joining self-review rejection, got %v", err)
		}
		approved, err := postgres.ReviewJoiningCase(ctx, db, created.Case.ID, "approved", "", 4, "idem-joining-approve-v3", postgres.HashJoiningCaseReview(created.Case.ID, "approved", "", 4), testOperatorActorID, "corr-joining-approve-v3")
		if err != nil || approved.Case.State != "approved" || approved.Case.Version != 5 || approved.Case.Store == nil || approved.Case.Store.PartnerActorID != testPartnerActorID {
			t.Fatalf("joining approval failed: %+v err=%v", approved, err)
		}

		item, err := postgres.CreateCatalogItem(ctx, db, approved.Case.Store.ID, "قهوة عربية", "idem-catalog-create-v3", postgres.HashCatalogCreateRequest(approved.Case.Store.ID, "قهوة عربية"), testPartnerActorID, "corr-catalog-create-v3")
		if err != nil || item.Item.PublicationState != "draft" || item.Item.Version != 1 || item.Replayed {
			t.Fatalf("catalog create failed: %+v err=%v", item, err)
		}
		itemReplay, err := postgres.CreateCatalogItem(ctx, db, approved.Case.Store.ID, "قهوة عربية", "idem-catalog-create-v3", postgres.HashCatalogCreateRequest(approved.Case.Store.ID, "قهوة عربية"), testPartnerActorID, "corr-catalog-replay-v3")
		if err != nil || !itemReplay.Replayed || itemReplay.Item.ID != item.Item.ID {
			t.Fatalf("catalog create replay failed: %+v err=%v", itemReplay, err)
		}
		if _, err := postgres.CreateCatalogItem(ctx, db, approved.Case.Store.ID, "شاي", "idem-catalog-create-v3", postgres.HashCatalogCreateRequest(approved.Case.Store.ID, "شاي"), testPartnerActorID, "corr-catalog-conflict-v3"); !errors.Is(err, postgres.ErrCatalogIdempotency) {
			t.Fatalf("expected catalog idempotency conflict, got %v", err)
		}
		if _, err := postgres.UpdateCatalogItem(ctx, db, approved.Case.Store.ID, item.Item.ID, "قهوة عربية", "published", true, 9, "idem-catalog-stale-v3", postgres.HashCatalogUpdateRequest(approved.Case.Store.ID, item.Item.ID, "قهوة عربية", "published", true, 9), testPartnerActorID, "corr-catalog-stale-v3"); !errors.Is(err, postgres.ErrCatalogVersion) {
			t.Fatalf("expected catalog version conflict, got %v", err)
		}
		publishedItem, err := postgres.UpdateCatalogItem(ctx, db, approved.Case.Store.ID, item.Item.ID, "قهوة عربية", "published", true, 1, "idem-catalog-publish-v3", postgres.HashCatalogUpdateRequest(approved.Case.Store.ID, item.Item.ID, "قهوة عربية", "published", true, 1), testPartnerActorID, "corr-catalog-publish-v3")
		if err != nil || publishedItem.Item.PublicationState != "published" || publishedItem.Item.Version != 2 {
			t.Fatalf("catalog publish failed: %+v err=%v", publishedItem, err)
		}
		if _, err := postgres.ReadPublishedStore(ctx, db, approved.Case.Store.ID); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("unpublished Store became public before Store publication: %v", err)
		}

		store, err := postgres.SetStorePublication(ctx, db, approved.Case.Store.ID, "published", 1, "idem-store-publish-v3", postgres.HashStorePublicationRequest(approved.Case.Store.ID, "published", 1), testOperatorActorID, "corr-store-publish-v3")
		if err != nil || store.Store.PublicationState != "published" || store.Store.Version != 2 {
			t.Fatalf("Store publication failed: %+v err=%v", store, err)
		}
		publicStore, err := postgres.ReadPublishedStore(ctx, db, approved.Case.Store.ID)
		if err != nil || len(publicStore.Items) != 1 || publicStore.Items[0].ID != item.Item.ID {
			t.Fatalf("public catalog readback failed: %+v err=%v", publicStore, err)
		}
		if _, err := postgres.SetStorePublication(ctx, db, approved.Case.Store.ID, "hidden", 1, "idem-store-stale-v3", postgres.HashStorePublicationRequest(approved.Case.Store.ID, "hidden", 1), testOperatorActorID, "corr-store-stale-v3"); !errors.Is(err, postgres.ErrPublicationVersionConflict) {
			t.Fatalf("expected Store version conflict, got %v", err)
		}
		hidden, err := postgres.SetStorePublication(ctx, db, approved.Case.Store.ID, "hidden", 2, "idem-store-hide-v3", postgres.HashStorePublicationRequest(approved.Case.Store.ID, "hidden", 2), testOperatorActorID, "corr-store-hide-v3")
		if err != nil || hidden.Store.PublicationState != "hidden" || hidden.Store.Version != 3 {
			t.Fatalf("Store hide failed: %+v err=%v", hidden, err)
		}
		if _, err := postgres.ReadPublishedStore(ctx, db, approved.Case.Store.ID); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("hidden Store remained public: %v", err)
		}

		var stores, cases, joiningAudit, catalogItems, catalogAudit, history int
		for _, check := range []struct {
			name  string
			query string
			out   *int
		}{
			{"stores", "SELECT count(*) FROM dsh.stores", &stores},
			{"joining cases", "SELECT count(*) FROM dsh.joining_cases", &cases},
			{"joining audit", "SELECT count(*) FROM dsh.joining_case_audit", &joiningAudit},
			{"catalog items", "SELECT count(*) FROM dsh.catalog_items", &catalogItems},
			{"catalog audit", "SELECT count(*) FROM dsh.catalog_item_audit", &catalogAudit},
			{"migration history", "SELECT count(*) FROM dsh.schema_migrations", &history},
		} {
			if err := db.QueryRowContext(ctx, check.query).Scan(check.out); err != nil {
				t.Fatalf("read %s: %v", check.name, err)
			}
		}
		if stores != 1 || cases != 1 || joiningAudit != 5 || catalogItems != 1 || catalogAudit != 2 || history != postgres.SchemaVersion {
			t.Fatalf("unexpected v3 readback: stores=%d cases=%d joiningAudit=%d catalogItems=%d catalogAudit=%d history=%d", stores, cases, joiningAudit, catalogItems, catalogAudit, history)
		}
	})
}

func withFreshDatabase(t *testing.T, rootDB *sql.DB, databaseURL string, test func(context.Context, *sql.DB, []postgres.MigrationRecord, []string)) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	databaseName := fmt.Sprintf("dsh_v3_test_%d", time.Now().UnixNano())
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
