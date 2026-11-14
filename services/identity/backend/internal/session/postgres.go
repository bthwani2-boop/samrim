package session

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
)

// The schema name is validated before passing it as a bound value to
// quote_ident. A transaction-local search path prevents connection-pool scope
// leakage and temporary relation shadowing.
var schemaRule = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

type PostgresReader struct {
	db     *sql.DB
	schema string
}

func NewPostgresReader(db *sql.DB, schema string) (*PostgresReader, error) {
	if db == nil || !schemaRule.MatchString(schema) {
		return nil, errors.New("invalid Identity owner data source")
	}
	return &PostgresReader{db: db, schema: schema}, nil
}

func (r *PostgresReader) Lookup(ctx context.Context, digest [32]byte) (Principal, error) {
	if r == nil || r.db == nil {
		return Principal{}, errors.New("identity database not connected")
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return Principal{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx,
		"SELECT pg_catalog.set_config('search_path', 'pg_catalog,' || pg_catalog.quote_ident($1) || ',pg_temp', true)",
		r.schema)
	if err != nil {
		return Principal{}, err
	}
	const query = `SELECT a.id,s.role,s.expires_at
        FROM auth_sessions s
        JOIN actors a ON a.id=s.actor_id
        JOIN actor_roles ar ON ar.actor_id=s.actor_id AND ar.role=s.role
        WHERE s.token_digest=$1
          AND s.revoked_at IS NULL AND s.issued_at<=CURRENT_TIMESTAMP AND s.expires_at>CURRENT_TIMESTAMP
          AND a.status='ACTIVE' AND ar.status='ACTIVE'
          AND s.actor_version=a.auth_version AND s.role_version=ar.version`
	var principal Principal
	err = tx.QueryRowContext(ctx, query, digest[:]).
		Scan(&principal.ActorID, &principal.Role, &principal.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Principal{}, ErrUnauthorized
	}
	if err != nil {
		return Principal{}, err
	}
	if err = tx.Commit(); err != nil {
		return Principal{}, err
	}
	return principal, nil
}
