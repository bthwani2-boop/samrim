package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"regexp"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

const isolatedMerchantVerifier = "https://identity:3343"

var merchantTestSchema = regexp.MustCompile(`^dsh_test_[a-z0-9_]+$`)

func isolatedMerchantStandingHandler(db *sql.DB, schema, listen string, existing http.Handler) (http.Handler, error) {
	if os.Getenv("DSH_ENABLE_ISOLATED_MERCHANT_STANDING") != "true" {
		return existing, nil
	}
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") != "true" ||
		!merchantTestSchema.MatchString(schema) || listen != "0.0.0.0:8080" ||
		os.Getenv("DSH_IDENTITY_VERIFIER_URL") != isolatedMerchantVerifier {
		return nil, fmt.Errorf("Merchant standing requires an isolated Docker schema and trusted Identity TLS")
	}
	identity, err := storeavailability.NewIdentitySessionHTTP(isolatedMerchantVerifier)
	if err != nil {
		return nil, err
	}
	reader, err := storeavailability.NewPostgresStoreGrants(db, schema)
	if err != nil {
		return nil, err
	}
	routes := http.NewServeMux()
	// This opt-in registers only the BFF's exact read endpoint. Queries that
	// reach it still require an authoritative current Merchant bearer.
	routes.Handle("GET /v1/stores/mine", storeavailability.NewMerchantStandingHandler(identity, reader))
	routes.Handle("/", existing)
	return routes, nil
}
