package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	transporthttp "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/transport/http"
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
		t.Run("public reads share the current Store media gate", func(t *testing.T) {
			// This disposable fixture represents reviewed publication. It does not
			// exercise the separate legal approval or publishing workflow.
			for _, statement := range []string{
				`INSERT INTO dsh.service_cities(id,display_name_ar) VALUES('catalog-test-city','Catalog test city')`,
				`UPDATE dsh.stores SET service_city_id='catalog-test-city' WHERE id='independent-catalog-store'`,
				`INSERT INTO dsh.independent_store_publications(store_id,state,review_state,terms_version,terms_accepted_by_actor_id,
					terms_accepted_at,published_at) VALUES('independent-catalog-store','PUBLISHED_INDEPENDENT','PASSED',
					'test-terms','independent-owner',now(),now())`,
				`INSERT INTO dsh.independent_store_customer_policies(store_id,policy_version,cancellation_terms,returns_terms,
					fulfillment_terms,collection_terms,authored_by_actor_id,review_state,reviewed_by_actor_id,published_at)
					VALUES('independent-catalog-store','test-policy','Cancellation','Returns','Fulfillment','Collection',
					'independent-owner','PASSED','test-reviewer',now())`,
				`INSERT INTO dsh.store_public_contacts(store_id,email,updated_by_actor_id)
					VALUES('independent-catalog-store','merchant@example.test','independent-owner')`,
				`INSERT INTO dsh.store_profile_media_assets(id,store_id,idempotency_key,request_hash,expected_case_version,
					object_key,uri,content_sha256,content_type,byte_size,media_role,state,attached_at,
					creator,source_description,rights_statement,rights_attested_by_actor_id,rights_attested_at)
					SELECT role,'independent-catalog-store',role,repeat('a',64),1,role,'https://cdn.example.test/'||role||'.jpg',
					repeat('a',64),'image/jpeg',1,role,'active',now(),'Test Creator','Test image','Test rights','independent-owner',now()
					FROM (VALUES ('primary'),('cover')) AS media(role)`,
			} {
				if _, err := db.ExecContext(ctx, statement); err != nil {
					t.Fatal(err)
				}
			}
			update := postgres.CatalogOfferUpdateInput{
				PriceMinor: 750, Availability: true, PublicationState: "published",
				QuantityPolicy: "DISCRETE", QuantityMinBaseUnits: 1, QuantityMaxBaseUnits: 5, QuantityStepBaseUnits: 1,
				PricingBasis: "PER_UNIT", PricingUnitBaseUnits: 1, InventoryPolicy: "AVAILABILITY_ONLY",
			}
			if _, err := postgres.UpdateCatalogOffer(ctx, db, offer.Offer.ID, update, offer.Offer.Version,
				"catalog-offer-publish", postgres.HashCatalogOfferUpdateRequest(offer.Offer.ID, update, offer.Offer.Version),
				"catalog-operator", "catalog-publish-correlation"); err != nil {
				t.Fatal(err)
			}

			mux := http.NewServeMux()
			transporthttp.NewIndependentPublicStorefront(db, true, "test-terms", "shop.example.test").Register(mux)
			storeURL := "https://shop.example.test/dsh/public/independent-stores/" + store.ID
			assertPublicStatus := func(cityID string, want int) {
				t.Helper()
				for _, suffix := range []string{"", "/catalog", "/banners"} {
					requestURL := storeURL + suffix + "?serviceCityId=" + cityID
					response := httptest.NewRecorder()
					mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestURL, nil))
					if response.Code != want {
						t.Errorf("%s returned %d, want %d: %s", requestURL, response.Code, want, response.Body)
					}
				}
			}
			assertPublicStatus("catalog-test-city", http.StatusOK)
			assertPublicStatus("another-city", http.StatusNotFound)
			for _, search := range []struct {
				text string
				want int
			}{{"Default", 1}, {"' OR 1=1 --", 0}} {
				response := httptest.NewRecorder()
				requestURL := storeURL + "/catalog?serviceCityId=catalog-test-city&q=" + url.QueryEscape(search.text)
				mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, requestURL, nil))
				var page postgres.IndependentPublicOfferPage
				if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil || response.Code != http.StatusOK {
					t.Fatalf("catalog search %q returned %d: %s (decode: %v)", search.text, response.Code, response.Body, err)
				}
				if len(page.Offers) != search.want || (search.want == 1 && (page.Offers[0].OfferID != offer.Offer.ID || page.Offers[0].PriceMinor != 750)) {
					t.Errorf("catalog search %q returned unexpected offers: %+v", search.text, page.Offers)
				}
				if len(page.Categories) != 1 || page.Categories[0].ID != "independent-catalog-category" {
					t.Errorf("catalog search %q lost the published category: %+v", search.text, page.Categories)
				}
			}
			if _, err := db.ExecContext(ctx, `UPDATE dsh.store_profile_media_assets SET uri='https://0x7f.0x0.0x0.0x1/private.jpg'
				WHERE store_id=$1 AND media_role='cover'`, store.ID); err != nil {
				t.Fatal(err)
			}
			assertPublicStatus("catalog-test-city", http.StatusNotFound)
			if _, err := postgres.ReadPublishedIndependentStore(ctx, db, store.ID, "test-terms"); !errors.Is(err, postgres.ErrIndependentStorefrontNotPublished) {
				t.Errorf("canonical Store reader admitted an unsafe cover: %v", err)
			}
		})
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
