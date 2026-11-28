package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"regexp"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

const isolatedDSHVerifierURL = "https://identity:3343"

var isolatedDSHSchema = regexp.MustCompile(`^dsh_test_[a-z0-9_]+$`)

func isolatedMerchantStandingHandler(db *sql.DB, schema, listen string, existing http.Handler) (http.Handler, error) {
	if os.Getenv("DSH_ENABLE_ISOLATED_MERCHANT_STANDING") != "true" {
		return existing, nil
	}
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") != "true" ||
		!isolatedDSHSchema.MatchString(schema) || listen != "0.0.0.0:8080" ||
		os.Getenv("DSH_IDENTITY_VERIFIER_URL") != isolatedDSHVerifierURL {
		return nil, fmt.Errorf("Merchant standing requires an isolated Docker schema and trusted Identity TLS")
	}
	identity, err := identityaccess.NewIdentitySessionHTTP(isolatedDSHVerifierURL)
	if err != nil {
		return nil, err
	}
	reader, err := storeavailability.NewPostgresStoreGrants(db, schema)
	if err != nil {
		return nil, err
	}
	registrar, err := storeavailability.NewMerchantStoreRegistrar(identity, reader)
	if err != nil {
		return nil, err
	}
	routes := http.NewServeMux()
	// Identity verifies the Merchant, and DSH is the only Store writer.
	// Every registration still checks an explicitly enabled city/relation policy
	// within the same owner SQL transaction as the new unpublished Store.
	routes.Handle("GET /v1/stores/mine", storeavailability.NewMerchantStandingHandler(identity, reader))
	profile := storeavailability.NewMerchantStoreProfileHandler(registrar)
	routes.Handle("GET /v1/stores/{storeID}/profile", profile)
	routes.Handle("PATCH /v1/stores/{storeID}/profile", profile)
	catalog, err := storeavailability.NewMerchantCatalogHandler(identity, db, schema)
	if err != nil {
		return nil, err
	}
	routes.Handle("GET /v1/stores/{storeID}/catalog", catalog)
	inventory, err := storeavailability.NewMerchantInventorySummaryHandler(identity, db, schema)
	if err != nil {
		return nil, err
	}
	routes.Handle("GET /v1/stores/{storeID}/inventory-summary", inventory)
	history, err := storeavailability.NewMerchantCatalogDraftHistoryHandler(identity, db, schema)
	if err != nil {
		return nil, err
	}
	routes.Handle("GET /v1/stores/{storeID}/catalog/{offerID}/draft-history", history)
	draft, err := storeavailability.NewMerchantCatalogDraftHandler(registrar)
	if err != nil {
		return nil, err
	}
	routes.Handle("POST /v1/stores/{storeID}/catalog", draft)
	edit, err := storeavailability.NewMerchantCatalogEditHandler(registrar)
	if err != nil {
		return nil, err
	}
	routes.Handle("PATCH /v1/stores/{storeID}/catalog/{offerID}", edit)
	importer, err := storeavailability.NewMerchantCatalogImportHandler(registrar)
	if err != nil {
		return nil, err
	}
	routes.Handle("/v1/stores/{storeID}/catalog-imports/{runID}", importer)
	registration := storeavailability.NewMerchantRegistrationHandler(registrar)
	routes.Handle("GET /v1/stores/registration-options", registration)
	routes.Handle("GET /v1/store-registration-receipts/{operationID}", registration)
	routes.Handle("POST /v1/stores", registration)
	routes.Handle("GET /v1/operators/cities/{cityID}/store-publication-review/{relation}", storeavailability.NewOperatorPublicationReviewHandler(identity, reader))
	operatorRegistrationPolicy, err := storeavailability.NewStoreRegistrationPolicyHandler(registrar)
	if err != nil {
		return nil, err
	}
	const policyPath = "/v1/operators/cities/{cityID}/store-registration-policy/{relation}"
	routes.Handle("GET "+policyPath, operatorRegistrationPolicy)
	routes.Handle("PATCH "+policyPath, operatorRegistrationPolicy)
	routes.Handle("GET "+policyPath+"/history", operatorRegistrationPolicy)
	routes.Handle("/", existing)
	return routes, nil
}
