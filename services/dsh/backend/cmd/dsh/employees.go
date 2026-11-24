package main

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"net/http"
	"os"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/employees"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

func isolatedEmployeeHandler(ctx context.Context, db *sql.DB, schema, listen string, existing http.Handler) (http.Handler, error) {
	if os.Getenv("DSH_ENABLE_ISOLATED_EMPLOYEES") != "true" {
		return existing, nil
	}
	host, _, err := net.SplitHostPort(listen)
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		err != nil || (host != "127.0.0.1" && host != "::1") {
		return nil, errors.New("employee directory requires loopback and explicit DSH isolation")
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
