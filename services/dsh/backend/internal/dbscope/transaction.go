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
