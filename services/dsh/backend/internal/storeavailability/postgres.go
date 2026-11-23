package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"regexp"

	"github.com/lib/pq"
)

// PostgresRepository writes operational facts in the SAME DSH Store schema.
// It never persists the derived orderability enum and never modifies WLT.
type PostgresRepository struct {
	db     *sql.DB
	schema string
}

var postgresSchemaRule = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

// beginScopedStoreTx binds every Store query to a single validated DSH schema,
// without constructing executable SQL from a schema identifier. SET LOCAL is
// transaction-scoped, so a pooled connection never retains Store access to a
// previous caller's schema. Explicit pg_catalog and pg_temp order also blocks
// temporary-table shadowing of canonical Store relations.
func beginScopedStoreTx(ctx context.Context, db *sql.DB, schema string, options *sql.TxOptions) (*sql.Tx, error) {
	if db == nil || !postgresSchemaRule.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	tx, err := db.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx,
		"SELECT pg_catalog.set_config('search_path', 'pg_catalog,' || pg_catalog.quote_ident($1) || ',pg_temp', true)", schema)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func NewPostgresRepository(db *sql.DB, schema string) (*PostgresRepository, error) {
	if db == nil || !postgresSchemaRule.MatchString(schema) {
		return nil, ErrInvalidChange
	}
	return &PostgresRepository{db: db, schema: schema}, nil
}

func normalizePgError(err error) error {
	var pg *pq.Error
	if errors.As(err, &pg) && pg.Code == "40001" {
		return ErrVersionConflict
	}
	return err
}
