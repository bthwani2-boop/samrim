package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/employees"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

func isolatedEmployeeHandler(ctx context.Context, db *sql.DB, schema, listen string, existing http.Handler) (http.Handler, error) {
	if os.Getenv("DSH_ENABLE_ISOLATED_EMPLOYEES") != "true" {
		return existing, nil
	}
	// Use the same verified DSH transport as protected Store availability.
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		!isolatedDSHSchema.MatchString(schema) || !isolatedAvailabilityTransport(listen, os.Getenv) {
		return nil, errors.New("employee directory requires isolated DSH schema and verified transport")
	}
	identity, err := identityaccess.NewIdentitySessionHTTP(os.Getenv("DSH_IDENTITY_VERIFIER_URL"))
	if err != nil {
		return nil, err
	}
	handler, err := employees.NewHandler(ctx, db, schema, identity)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/operators/employees", handler)
	mux.Handle("/v1/operators/employees/", handler)
	mux.Handle("/v1/stores/{storeID}/employees", handler)
	mux.Handle("/v1/stores/{storeID}/employees/{id}", handler)
	mux.Handle("/v1/stores/{storeID}/employees/{id}/registration-audit", handler)
	mux.Handle("/", existing)
	return mux, nil
}
