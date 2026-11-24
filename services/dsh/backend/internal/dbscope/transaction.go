// Package dbscope binds owner-local PostgreSQL relations to a transaction.
// It does not own any domain facts or grant database privileges.
package dbscope

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
)

var schemaName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

// Bind uses a bound identifier and transaction-local search_path. Required
// relations are checked against their qualified identity, so an absent owner
// relation cannot silently resolve to a temporary table.
func Bind(ctx context.Context, tx *sql.Tx, schema string, requiredRelations ...string) error {
	if tx == nil || !schemaName.MatchString(schema) {
		return errors.New("invalid owner transaction scope")
	}
	if _, err := tx.ExecContext(ctx,
		"SELECT pg_catalog.set_config('search_path', 'pg_catalog,' || pg_catalog.quote_ident($1) || ',pg_temp', true)", schema); err != nil {
		return err
	}
	for _, relation := range requiredRelations {
		var exact bool
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(
			pg_catalog.to_regclass($1) = pg_catalog.to_regclass(pg_catalog.format('%I.%I',$2::text,$1::text)), false)`,
			relation, schema).Scan(&exact); err != nil {
			return err
		}
		if !exact {
			return errors.New("required owner relation unavailable")
		}
	}
	return nil
}

// Begin returns a scoped transaction or rolls it back before returning an error.
func Begin(ctx context.Context, db *sql.DB, schema string, options *sql.TxOptions, requiredRelations ...string) (*sql.Tx, error) {
	if db == nil || !schemaName.MatchString(schema) {
		return nil, errors.New("invalid owner transaction scope")
	}
	tx, err := db.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	if err = Bind(ctx, tx, schema, requiredRelations...); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

// DevelopmentDatabase and DevelopmentRuntimeRole identify the isolated DSH
// development owner, not the shared refoundation administrator.
const DevelopmentDatabase = "bthwani_dsh_dev"
const DevelopmentRuntimeRole = "bthwani_dsh_runtime"

var developmentSchema = regexp.MustCompile(`^dsh_test_[a-z0-9_]+$`)

// IsDevelopmentDatabase preserves the exact historical disposable fixture
// boundary while admitting the separately provisioned owner database.
func IsDevelopmentDatabase(name string) bool {
	return name == DevelopmentDatabase || name == "bthwani_refoundation"
}

// IsCartPrincipal keeps the old CI fixture pairs separate from the dedicated
// runtime pair. Never admit the shared administrator or an arbitrary role.
func IsCartPrincipal(database, role string) bool {
	return (database == DevelopmentDatabase && role == DevelopmentRuntimeRole) ||
		(database == "bthwani_refoundation" && (role == "bthwani_ci" || role == "bthwani_agent02"))
}

// VerifyDevelopmentRuntime establishes the actual database principal and
// owner schema before a development container exposes any HTTP route.
func VerifyDevelopmentRuntime(ctx context.Context, db *sql.DB, schema string) error {
	if db == nil || !schemaName.MatchString(schema) || !developmentSchema.MatchString(schema) {
		return errors.New("DSH development database scope invalid")
	}
	var admitted bool
	err := db.QueryRowContext(ctx, `SELECT current_database()=$1 AND current_user=$2
		AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
		AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
		AND NOT pg_catalog.has_database_privilege(current_database(),'CREATE')
		AND NOT pg_catalog.has_database_privilege(current_database(),'TEMP')
		AND NOT pg_catalog.has_schema_privilege('public','CREATE')
		AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname=$3
			AND n.nspowner<>r.oid
			AND pg_catalog.has_schema_privilege(n.oid,'USAGE')
			AND NOT pg_catalog.has_schema_privilege(n.oid,'CREATE'))
		FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`, DevelopmentDatabase, DevelopmentRuntimeRole, schema).Scan(&admitted)
	if err != nil || !admitted {
		return errors.New("DSH development runtime requires its dedicated database and limited role")
	}
	return nil
}
