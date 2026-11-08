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

func TestIndependentStorePreviewOwnershipAndChannelIsolation(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required for independent preview proof")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })

	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: "independent-preview-store", PartnerActorID: "independent-owner", Name: "Independent preview",
		})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: "market-preview-store", PartnerActorID: "market-owner", Name: "Marketplace store",
		})
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE' WHERE id='independent-preview-store'`); err != nil {
			t.Fatal(err)
		}

		availability, err := postgres.ReadStoreOperationalAvailability(ctx, db, "independent-preview-store")
		if err != nil || availability.ScheduleMode != "WEEKLY" || len(availability.WeeklySchedule) != 0 {
			t.Fatalf("lazy initialization must keep independent Store closed: %+v err=%v", availability, err)
		}
		orderability, err := postgres.EvaluateStoreOrderability(ctx, db, "independent-preview-store", "CUSTOMER_PICKUP", time.Time{})
		if err != nil || orderability.State != postgres.StoreOrderabilityClosedBySchedule {
			t.Fatalf("an independent Store must choose opening hours before pickup: %+v err=%v", orderability, err)
		}
		marketAvailability, err := postgres.ReadStoreOperationalAvailability(ctx, db, "market-preview-store")
		if err != nil || marketAvailability.ScheduleMode != "ALWAYS_OPEN" {
			t.Fatalf("legacy marketplace availability default changed: %+v err=%v", marketAvailability, err)
		}

		store, err := postgres.ReadIndependentStoreOwnedByPartner(ctx, db, "independent-preview-store", "independent-owner")
		if err != nil || store.ID != "independent-preview-store" || store.RelationModel != postgres.StoreRelationIndependent || store.PublicationState == "published" {
			t.Fatalf("owned unpublished independent Store must be previewable: %+v err=%v", store, err)
		}
		accessible, err := postgres.ListPartnerAccessibleStores(ctx, db, "independent-owner", 10, "")
		if err != nil || len(accessible.Stores) != 1 || accessible.Stores[0].ID != store.ID ||
			accessible.Stores[0].RelationModel != postgres.StoreRelationIndependent {
			t.Fatalf("Partner Store scope must report the canonical independent relationship: %+v err=%v", accessible, err)
		}
		// A direct Store keeps its existing DSH Catalog ownership. Use the
		// canonical product and offer writers, not a second storefront table.
		verticalID := "independent-preview-store-vertical"
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_categories
			(id,vertical_id,name_ar,name_en,active)
			VALUES('independent-preview-category',$1,'فئة للمعاينة','Preview category',true)`, verticalID); err != nil {
			t.Fatal(err)
		}
		productInput := postgres.CatalogProductInput{
			VerticalID: verticalID, Scope: "SHARED", CanonicalName: "منتج المعاينة",
			VariantTitle: "Default", MeasurementKind: "DISCRETE", BaseUnit: "COUNT",
			CategoryIDs: []string{"independent-preview-category"},
		}
		product, err := postgres.CreateCatalogProduct(ctx, db, productInput, "preview-product-create", postgres.HashCatalogProductCreateRequest(productInput), "preview-operator", "preview-product-correlation")
		if err != nil {
			t.Fatal(err)
		}
		offerInput := postgres.CatalogOfferInput{
			StoreID: store.ID, VariantID: product.Product.Variants[0].ID, PriceMinor: 750,
			QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1,
			QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1,
			PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1,
			InventoryPolicy: "AVAILABILITY_ONLY",
		}
		offer, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "preview-offer-create", postgres.HashCatalogOfferCreateRequest(offerInput), "preview-operator", "preview-offer-correlation")
		if err != nil {
			t.Fatal(err)
		}
		page, err := postgres.ListCatalogOfferPage(ctx, db, store.ID, 20, "")
		if err != nil || len(page.Offers) != 1 || page.Offers[0].ID != offer.Offer.ID ||
			page.Offers[0].Product.ID != product.Product.ID || page.Offers[0].PriceMinor != 750 {
			t.Fatalf("independent Store must reuse the exact canonical Product and Offer: %+v err=%v", page, err)
		}
		for _, input := range []struct{ storeID, actorID string }{
			{"independent-preview-store", "other-partner"},
			{"market-preview-store", "market-owner"},
			{"market-preview-store", "independent-owner"},
			{"missing-store", "independent-owner"},
		} {
			if _, err := postgres.ReadIndependentStoreOwnedByPartner(ctx, db, input.storeID, input.actorID); !errors.Is(err, postgres.ErrStoreNotFound) {
				t.Fatalf("foreign or marketplace Store leaked through independent preview: %+v err=%v", input, err)
			}
		}
		if _, _, err := postgres.SetStoreTrashed(ctx, db, store.ID, "preview-operator", "archived fixture store", "trash", "preview-archive-key", store.Version); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.ReadIndependentStoreOwnedByPartner(ctx, db, "independent-preview-store", "independent-owner"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("archived Store must not have a partner preview: %v", err)
		}
	})
}
