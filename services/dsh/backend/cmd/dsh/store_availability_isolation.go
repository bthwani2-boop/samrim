package main

import (
	"context"
	"database/sql"
	"errors"
	"net"
)

// Reuse the admitted DSH TLS peer and host-loopback Compose transport;
// the wildcard listener is not a generic container or public-network opt-in.
func isolatedAvailabilityTransport(listen string, getenv func(string) string) bool {
	host, _, err := net.SplitHostPort(listen)
	if err == nil && (host == "127.0.0.1" || host == "::1") {
		return true
	}
	return listen == "0.0.0.0:8080" &&
		getenv("BTHWANI_ISOLATED_CONTAINER_MODE") == "true" &&
		getenv("DSH_IDENTITY_VERIFIER_URL") == isolatedDSHVerifierURL &&
		getenv("DSH_DB_HOST") == "postgres" &&
		getenv("REF_POSTGRES_DB") == "bthwani_refoundation"
}

func verifyAvailabilityContainerDatabase(ctx context.Context, db *sql.DB, schema string) error {
	if db == nil || !isolatedDSHSchema.MatchString(schema) {
		return errors.New("Store availability database identity unverified")
	}
	var verified bool
	err := db.QueryRowContext(ctx, `SELECT current_database()='bthwani_refoundation' AND
  (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind='r' AND c.relname IN
    ('stores','service_cities','store_operational_availability','store_operational_weekly_hours',
    'store_operational_commands','store_operational_audit','store_operational_limits',
    'store_operational_limits_audit','store_operational_policy_commands'))=9`, schema).Scan(&verified)
	if err != nil || !verified {
		return errors.New("Store availability requires the verified isolated database and complete owner schema")
	}
	return nil
}
