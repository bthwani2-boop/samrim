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

func TestIndependentStoreCanonicalCatalogAndOwnerScope(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required for independent Catalog proof")
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
			ID: "independent-catalog-store", PartnerActorID: "independent-owner", Name: "Independent catalog",
		})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: "market-catalog-store", PartnerActorID: "market-owner", Name: "Marketplace store",
		})
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE' WHERE id='independent-catalog-store'`); err != nil {
			t.Fatal(err)
		}
		status, err := postgres.ReadIndependentPublicationForOperator(ctx, db, "independent-catalog-store")
		if err != nil || status.StoreID != "independent-catalog-store" || status.State != "DRAFT" ||
			status.ReviewState != "NOT_CHECKED" || status.Version != 1 || status.ReviewReason != "" {
			t.Fatalf("private operator must read DSH's canonical independent draft version: %+v err=%v", status, err)
		}
		if _, err := postgres.ReadIndependentPublicationForOperator(ctx, db, "market-catalog-store"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("marketplace Store must never be represented as an independent publication: %v", err)
		}

		availability, err := postgres.ReadStoreOperationalAvailability(ctx, db, "independent-catalog-store")
		if err != nil || availability.ScheduleMode != "WEEKLY" || len(availability.WeeklySchedule) != 0 {
			t.Fatalf("lazy initialization must keep independent Store closed: %+v err=%v", availability, err)
		}
		orderability, err := postgres.EvaluateStoreOrderability(ctx, db, "independent-catalog-store", "CUSTOMER_PICKUP", time.Time{})
		if err != nil || orderability.State != postgres.StoreOrderabilityClosedBySchedule {
			t.Fatalf("an independent Store must choose opening hours before pickup: %+v err=%v", orderability, err)
		}
		marketAvailability, err := postgres.ReadStoreOperationalAvailability(ctx, db, "market-catalog-store")
		if err != nil || marketAvailability.ScheduleMode != "ALWAYS_OPEN" {
			t.Fatalf("legacy marketplace availability default changed: %+v err=%v", marketAvailability, err)
		}

		store, err := postgres.ReadStoreOwnedByPartner(ctx, db, "independent-catalog-store", "independent-owner")
		if err != nil || store.ID != "independent-catalog-store" || store.RelationModel != postgres.StoreRelationIndependent || store.PublicationState == "published" {
			t.Fatalf("owned unpublished independent Store must keep canonical Store facts: %+v err=%v", store, err)
		}
		accessible, err := postgres.ListPartnerAccessibleStores(ctx, db, "independent-owner", 10, "")
		if err != nil || len(accessible.Stores) != 1 || accessible.Stores[0].ID != store.ID ||
			accessible.Stores[0].RelationModel != postgres.StoreRelationIndependent {
			t.Fatalf("Partner Store scope must report the canonical independent relationship: %+v err=%v", accessible, err)
		}
		grant, replayed, err := postgres.CreateStoreAccessInvitation(ctx, db, store.ID,
			"independent-owner", "independent-staff", []string{"catalog", "orders"},
			"independent-catalog-staff-invite-v1", "independent-catalog-staff-correlation-v1")
		if err != nil || replayed {
			t.Fatalf("cannot create isolated Store-scoped staff invitation: grant=%+v replayed=%v err=%v", grant, replayed, err)
		}
		activateGrantDirectly(t, ctx, db, grant, "independent-owner")
		staffPage, err := postgres.ListPartnerAccessibleStores(ctx, db, "independent-staff", 10, "")
		if err != nil || len(staffPage.Stores) != 1 || staffPage.Stores[0].ID != store.ID || staffPage.Stores[0].Owned {
			t.Fatalf("active staff grant cannot read its canonical Store: %+v err=%v", staffPage, err)
		}
		// A direct Store keeps its existing DSH Catalog ownership. Use the
		// canonical product and offer writers, not a second storefront table.
		verticalID := "independent-catalog-store-vertical"
		if _, err := db.ExecContext(ctx, `INSERT INTO dsh.catalog_categories
			(id,vertical_id,name_ar,name_en,active)
			VALUES('independent-catalog-category',$1,'فئة للمعاينة','Catalog category',true)`, verticalID); err != nil {
			t.Fatal(err)
		}
		productInput := postgres.CatalogProductInput{
			VerticalID: verticalID, Scope: "SHARED", CanonicalName: "منتج المعاينة",
			VariantTitle: "Default", MeasurementKind: "DISCRETE", BaseUnit: "COUNT",
			CategoryIDs: []string{"independent-catalog-category"},
		}
		product, err := postgres.CreateCatalogProduct(ctx, db, productInput, "catalog-product-create", postgres.HashCatalogProductCreateRequest(productInput), "catalog-operator", "catalog-product-correlation")
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
		offer, err := postgres.CreateCatalogOffer(ctx, db, offerInput, "catalog-offer-create", postgres.HashCatalogOfferCreateRequest(offerInput), "catalog-operator", "catalog-offer-correlation")
		if err != nil {
			t.Fatal(err)
		}
		page, err := postgres.ListCatalogOfferPage(ctx, db, store.ID, 20, "")
		if err != nil || len(page.Offers) != 1 || page.Offers[0].ID != offer.Offer.ID ||
			page.Offers[0].Product.ID != product.Product.ID || page.Offers[0].PriceMinor != 750 {
			t.Fatalf("independent Store must reuse the exact canonical Product and Offer: %+v err=%v", page, err)
		}
		for _, input := range []struct{ storeID, actorID string }{
			{"independent-catalog-store", "other-partner"},
			{"market-catalog-store", "independent-owner"},
			{"missing-store", "independent-owner"},
		} {
			if _, err := postgres.ReadStoreOwnedByPartner(ctx, db, input.storeID, input.actorID); !errors.Is(err, postgres.ErrStoreNotFound) {
				t.Fatalf("foreign Store leaked through canonical owned Store read: %+v err=%v", input, err)
			}
		}
		if _, _, err := postgres.SetStoreTrashed(ctx, db, store.ID, "catalog-operator", "archived fixture store", "trash", "catalog-archive-key", store.Version); err != nil {
			t.Fatal(err)
		}
		for _, actorID := range []string{"independent-owner", "independent-staff"} {
			archived, archivedErr := postgres.ListPartnerAccessibleStores(ctx, db, actorID, 10, "")
			if archivedErr != nil || len(archived.Stores) != 0 {
				t.Fatalf("archived Store must disappear from owner and staff navigation, actor=%s page=%+v err=%v",
					actorID, archived, archivedErr)
			}
		}
		if _, err := postgres.ReadIndependentPublicationForOperator(ctx, db, store.ID); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("archived Store must not return independent publication facts to operator: %v", err)
		}
	})
}
