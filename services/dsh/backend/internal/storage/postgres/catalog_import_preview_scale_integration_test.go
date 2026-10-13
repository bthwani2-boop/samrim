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

func TestCatalogImportPreviewPersistsFiveThousandStoreRows(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("requires an exclusively owned disposable DSH_DATABASE_URL")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	if err = root.Ping(); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("fresh DSH migrations: %v", err)
		}
		const storeID = "agent02-scale-import-store"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: "agent02-partner", Name: "Scale Import Store"})
		const n = 5000
		items := make([]postgres.CatalogImportItemRecord, 0, n)
		hashes := make([]postgres.CatalogImportItemInput, 0, n)
		for i := 0; i < n; i++ {
			row := i + 2
			input := &postgres.StoreCatalogImportItemInput{VariantID: fmt.Sprintf("synthetic-variant-%d", i+1), PriceMinor: int64(100 + i)}
			item := postgres.CatalogImportItemRecord{RowNumber: row, StableKey: fmt.Sprintf("store-offer-row-%d", row), Classification: "READY", StoreOfferInput: input}
			if i%100 == 0 {
				item.Classification = "INVALID_INPUT"
				code := "INVALID_INPUT"
				item.ErrorCode = &code
			}
			items = append(items, item)
			hashes = append(hashes, postgres.CatalogImportItemInput{RowNumber: row, StableKey: item.StableKey, StoreOfferInput: input})
		}
		run := postgres.CatalogImportRunRecord{
			ID: "agent02-5000-preview", ActingActorID: "agent02-partner",
			StoreID: storeID, Purpose: "STORE_OFFERS", ActorRole: "PARTNER",
			SourceSHA256: strings.Repeat("a", 64),
		}
		hash := postgres.HashCatalogImportPreviewRequest(run.ID, run.SourceSHA256, hashes)
		started := time.Now()
		first, err := postgres.CreateCatalogImportPreview(ctx, db, run, items, "agent02-5000-preview-key", hash, "agent02-5000-correlation")
		if err != nil {
			t.Fatalf("persist 5000 preview rows: %v", err)
		}
		if first.Replayed || first.Run.AcceptedCount != 4950 || first.Run.ConflictCount != 50 || len(first.Items) != n {
			t.Fatalf("first preview inconsistent: rows=%d accepted=%d conflicts=%d replay=%t", len(first.Items), first.Run.AcceptedCount, first.Run.ConflictCount, first.Replayed)
		}
		var persisted, audit int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_import_run_items WHERE run_id=$1", run.ID).Scan(&persisted); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.catalog_import_audit WHERE run_id=$1 AND event_type='import_previewed'", run.ID).Scan(&audit); err != nil {
			t.Fatal(err)
		}
		if persisted != n || audit != 1 {
			t.Fatalf("persisted items=%d audit=%d, want 5000/1", persisted, audit)
		}
		replay, err := postgres.CreateCatalogImportPreview(ctx, db, run, items, "agent02-5000-preview-key", hash, "agent02-5000-correlation")
		if err != nil || !replay.Replayed || len(replay.Items) != n {
			t.Fatalf("same-key replay: rows=%d replay=%t err=%v", len(replay.Items), replay.Replayed, err)
		}
		if _, err := postgres.CreateCatalogImportPreview(ctx, db, run, items, "agent02-5000-preview-key", "different-hash", "agent02-5000-correlation"); !errors.Is(err, postgres.ErrCatalogIdempotencyConflict) {
			t.Fatalf("changed payload with same idempotency key: %v", err)
		}
		t.Logf("STORE_IMPORT_5000_PREVIEW_PERSISTED rows=%d accepted=%d conflicts=%d audit=%d replay=true elapsed=%s; preview only, no StoreOffer commit", persisted, first.Run.AcceptedCount, first.Run.ConflictCount, audit, time.Since(started))
	})
}
