package session

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
)

var schemaRule = regexp.MustCompile(`^[a-z][a-z0-9_]{0,62}$`)

type PostgresReader struct {
	db     *sql.DB
	schema string
}

func NewPostgresReader(db *sql.DB, schema string) (*PostgresReader, error) {
	if db == nil || !schemaRule.MatchString(schema) || !strings.HasPrefix(schema, "identity_test_") || len(schema) <= len("identity_test_") {
		return nil, errors.New("invalid Identity owner data source")
	}
	return &PostgresReader{db: db, schema: schema}, nil
}

// One read-only Repeatable Read transaction owns the session and effective
// permission decision, so role/grant state cannot be mixed across snapshots.
func (r *PostgresReader) beginRead(ctx context.Context) (*sql.Tx, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("identity database not connected")
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	// Quote the strictly validated owner schema using a bound parameter.
	// The transaction-local path cannot escape into pooled connections.
	_, err = tx.ExecContext(ctx,
		"SELECT pg_catalog.set_config('search_path', 'pg_catalog,' || pg_catalog.quote_ident($1) || ',pg_temp', true)",
		r.schema)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}
func lookupPrincipal(ctx context.Context, tx *sql.Tx, digest [32]byte) (Principal, error) {
	const query = `SELECT a.id,s.role,s.expires_at
        FROM auth_sessions s
        JOIN actors a ON a.id=s.actor_id
        JOIN actor_roles ar ON ar.actor_id=s.actor_id AND ar.role=s.role
        WHERE s.token_digest=$1
          AND s.revoked_at IS NULL AND s.issued_at<=CURRENT_TIMESTAMP AND s.expires_at>CURRENT_TIMESTAMP
          AND a.status='ACTIVE' AND ar.status='ACTIVE'
          AND s.actor_version=a.auth_version AND s.role_version=ar.version`
	var principal Principal
	err := tx.QueryRowContext(ctx, query, digest[:]).
		Scan(&principal.ActorID, &principal.Role, &principal.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Principal{}, ErrUnauthorized
	}
	if err != nil {
		return Principal{}, err
	}
	return principal, nil
}
func (r *PostgresReader) Lookup(ctx context.Context, digest [32]byte) (Principal, error) {
	tx, err := r.beginRead(ctx)
	if err != nil {
		return Principal{}, err
	}
	defer tx.Rollback()
	principal, err := lookupPrincipal(ctx, tx, digest)
	if err != nil {
		return Principal{}, err
	}
	if err = tx.Commit(); err != nil {
		return Principal{}, err
	}
	return principal, nil
}
func (r *PostgresReader) LookupPermission(ctx context.Context, digest [32]byte, permission string) (Principal, error) {
	if !isOperatorPermission(permission) {
		return Principal{}, ErrForbidden
	}
	tx, err := r.beginRead(ctx)
	if err != nil {
		return Principal{}, err
	}
	defer tx.Rollback()
	principal, err := lookupPrincipal(ctx, tx, digest)
	if err != nil {
		return Principal{}, err
	}
	if principal.Role != "operator" {
		return Principal{}, ErrForbidden
	}
	var exists bool
	err = tx.QueryRowContext(ctx,
		"SELECT true FROM operator_permissions WHERE actor_id=$1 AND permission=$2 AND state='ACTIVE'",
		principal.ActorID, permission).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return Principal{}, ErrForbidden
	}
	if err != nil {
		return Principal{}, err
	}
	if !exists {
		return Principal{}, ErrForbidden
	}
	if err = tx.Commit(); err != nil {
		return Principal{}, err
	}
	return principal, nil
}
