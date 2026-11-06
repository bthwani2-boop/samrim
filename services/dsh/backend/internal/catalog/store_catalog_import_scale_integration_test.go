package catalog

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// This test creates and drops only its own child database under the explicitly
// disposable Fast Guard PostgreSQL parent. It never modifies the parent DB.
func TestStoreCatalogImport5000RowsPartialCommitReadback(t *testing.T) {
	if os.Getenv("BTHWANI_IMPORT_SCALE_PROOF_ISOLATED") != "1" {
		t.Skip("explicit isolated catalog-import scale proof is required")
	}
	raw := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	target, err := url.Parse(raw)
	if err != nil || target == nil || target.Scheme != "postgres" ||
		target.Hostname() != "127.0.0.1" || target.Port() != "19432" ||
		target.Path != "/dsh_proof" || target.User == nil ||
		target.User.Username() != "postgres" || target.Fragment != "" {
		t.Fatal("refuse catalog-import scale proof outside dedicated disposable CI PostgreSQL")
	}
	for key := range target.Query() {
		if key != "sslmode" && key != "connect_timeout" {
			t.Fatal("refuse PostgreSQL connection-routing query override")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	root, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	childName := fmt.Sprintf("dsh_catalog_import_scale_%d", time.Now().UnixNano())
	if _, err := root.ExecContext(ctx, "CREATE DATABASE "+childName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		if _, dropErr := root.ExecContext(cleanup, "DROP DATABASE IF EXISTS "+childName+" WITH (FORCE)"); dropErr != nil {
			t.Errorf("remove disposable catalog-import scale database: %v", dropErr)
		}
	})
	childURL := *target
	childURL.Path = "/" + childName
	db, err := sql.Open("postgres", childURL.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	migrations, statements, err := postgres.LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	keys, err := postgres.NewDeliveryProofKeyring("test-v1", map[string]string{
		"test-v1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := postgres.Migrate(ctx, db, migrations, statements, keys); err != nil {
		t.Fatal(err)
	}
	if err := postgres.VerifySchema(ctx, db, migrations); err != nil {
		t.Fatal(err)
	}

	const storeID, actorID, verticalID = "scale-import-store", "scale-import-partner", "scale-import-vertical"
	if _, err := db.ExecContext(ctx,
		"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,'Scale Test','Scale Test')",
		verticalID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx,
		"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES($1,$2,'Scale Type','Scale Type')",
		"scale-import-type", verticalID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx,
		"INSERT INTO dsh.stores(id,partner_actor_id,name,primary_vertical_id,commercial_store_type_id) VALUES($1,$2,'Scale Store',$3,$4)",
		storeID, actorID, verticalID, "scale-import-type"); err != nil {
		t.Fatal(err)
	}

	var data bytes.Buffer
	data.WriteString("name,price\n")
	for n := 1; n <= MaxStoreCatalogImportRows; n++ {
		if n <= 2 {
			fmt.Fprintf(&data, "Scale Product %d,%d\n", n, n*100)
		} else {
			// Rejected rows must not abort the valid minority; this stresses
			// durable accounting for many invalid inputs in one run.
			fmt.Fprintf(&data, "Scale Rejected %d,0\n", n)
		}
	}
	service := &Service{db: db}
	preview, err := service.previewStoreCatalogImport(ctx, actorID, "PARTNER", storeID, "", "scale.csv",
		data.Bytes(), "scale-import-preview", "scale-import-correlation")
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Items) != MaxStoreCatalogImportRows ||
		preview.Run.AcceptedCount != 2 ||
		preview.Run.ConflictCount != MaxStoreCatalogImportRows-2 {
		t.Fatalf("5,000-row preview: count=%d accepted=%d conflicts=%d",
			len(preview.Items), preview.Run.AcceptedCount, preview.Run.ConflictCount)
	}
	storedPreview, err := postgres.ReadCatalogImportRun(ctx, db, preview.Run.ID)
	if err != nil || len(storedPreview.Items) != MaxStoreCatalogImportRows ||
		storedPreview.Run.State != "previewed" ||
		storedPreview.Items[0].Classification != "READY" ||
		storedPreview.Items[MaxStoreCatalogImportRows-1].Classification != "INVALID_INPUT" {
		t.Fatalf("durable 5,000-row preview readback: state=%s count=%d err=%v",
			storedPreview.Run.State, len(storedPreview.Items), err)
	}
	if _, err := service.commitStoreCatalogImport(ctx, "other-actor", "PARTNER", storeID,
		preview.Run.ID, "wrong-actor-key", "wrong-actor-correlation"); !errors.Is(err, postgres.ErrCatalogImportInvalid) {
		t.Fatalf("wrong actor must not commit another actor's preview: %v", err)
	}
	committed, err := service.commitStoreCatalogImport(ctx, actorID, "PARTNER", storeID,
		preview.Run.ID, "scale-import-commit", "scale-import-correlation")
	if err != nil {
		t.Fatal(err)
	}
	if committed.Run.State != "committed" || len(committed.Items) != MaxStoreCatalogImportRows {
		t.Fatalf("5,000-row partial commit failed: state=%s rows=%d",
			committed.Run.State, len(committed.Items))
	}
	for i := 0; i < 2; i++ {
		item := committed.Items[i]
		if item.Classification != "IMPORTED" || !item.Committed || item.ProductID == nil || item.VariantID == nil {
			t.Fatalf("valid row %d not actually committed: %+v", i+1, item)
		}
		product, readErr := postgres.ReadCatalogProduct(ctx, db, *item.ProductID)
		if readErr != nil || product.StoreID != storeID ||
			product.CanonicalName != fmt.Sprintf("Scale Product %d", i+1) {
			t.Fatalf("canonical Product readback missing for row %d: %+v err=%v", i+1, product, readErr)
		}
		var offerID string
		if err := db.QueryRowContext(ctx, "SELECT id FROM dsh.catalog_store_offers WHERE store_id=$1 AND variant_id=$2",
			storeID, *item.VariantID).Scan(&offerID); err != nil {
			t.Fatalf("persisted offer missing: %v", err)
		}
		offer, readErr := postgres.ReadCatalogOffer(ctx, db, offerID)
		if readErr != nil || offer.StoreID != storeID || offer.PriceMinor != int64((i+1)*100) {
			t.Fatalf("canonical StoreOffer readback missing for row %d: %+v err=%v", i+1, offer, readErr)
		}
	}
	for _, item := range committed.Items[2:] {
		if item.Classification != "INVALID_INPUT" || item.Committed {
			t.Fatalf("invalid row %d unexpectedly mutated: %+v", item.RowNumber, item)
		}
	}
	replayed, err := service.commitStoreCatalogImport(ctx, actorID, "PARTNER", storeID,
		preview.Run.ID, "scale-import-commit", "retry-correlation")
	if err != nil || !replayed.Replayed {
		t.Fatalf("commit replay must return persisted result: replayed=%v err=%v", replayed.Replayed, err)
	}
	var offers, products, audits int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.catalog_store_offers WHERE store_id=$1", storeID).Scan(&offers); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.catalog_products WHERE store_id=$1", storeID).Scan(&products); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.catalog_import_audit WHERE run_id=$1", preview.Run.ID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if offers != 2 || products != 2 || audits != 2 {
		t.Fatalf("duplicate writer effect after commit replay: offers=%d products=%d audit=%d", offers, products, audits)
	}
	t.Log("5,000-row preview, two real StoreOffer commits, 4,998 rejected rows, actor rejection and replay-safe persistent readback PASS")
}
