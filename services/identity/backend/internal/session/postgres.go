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

// IsIsolatedTestSchema is the single canonical validation shared by the
// development listener and the PostgreSQL owner. No protected namespace is valid.
func IsIsolatedTestSchema(schema string) bool {
	return schemaRule.MatchString(schema) && strings.HasPrefix(schema, "identity_test_") &&
		len(schema) > len("identity_test_")
}

func NewPostgresReader(db *sql.DB, schema string) (*PostgresReader, error) {
	if db == nil || !IsIsolatedTestSchema(schema) {
		return nil, errors.New("invalid Identity owner data source")
	}
	return &PostgresReader{db: db, schema: schema}, nil
}

// Read-only Repeatable Read owns session and effective permission decisions;
// credential revocation uses an atomic conditional write without an older
// read snapshot, so concurrent logout retries cannot succeed twice.
func (r *PostgresReader) beginRead(ctx context.Context) (*sql.Tx, error) {
	return r.begin(ctx, true)
}

func (r *PostgresReader) begin(ctx context.Context, readOnly bool) (*sql.Tx, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("identity database not connected")
	}
	isolation := sql.LevelRepeatableRead
	if !readOnly {
		// SQL UPDATE is the single atomic authorization/write boundary.
		// ReadCommitted permits concurrent losers to observe the committed
		// revoked_at value instead of emitting a serialization error.
		isolation = sql.LevelReadCommitted
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: readOnly, Isolation: isolation})
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

// Revoke is the sole Identity owner write for this bounded logout endpoint.
// One conditional SQL update guarantees that a suspended/stale/revoked bearer
// cannot act, and it cannot revoke another actor's credential.
func (r *PostgresReader) Revoke(ctx context.Context, digest [32]byte) error {
	tx, err := r.begin(ctx, false)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Lock the presented session before checking expiry. A concurrent writer
	// may hold this row past the credential deadline: CURRENT_TIMESTAMP
	// would still represent this transaction's earlier start time.
	var lockedDigest []byte
	err = tx.QueryRowContext(ctx,
		"SELECT token_digest FROM auth_sessions WHERE token_digest=$1 FOR UPDATE", digest[:],
	).Scan(&lockedDigest)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE auth_sessions AS s
        SET revoked_at=clock_timestamp()
        FROM actors AS a, actor_roles AS ar
        WHERE s.token_digest=$1 AND s.revoked_at IS NULL
          AND s.issued_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
          AND s.actor_id=a.id AND a.status='ACTIVE' AND s.actor_version=a.auth_version
          AND ar.actor_id=s.actor_id AND ar.role=s.role
          AND ar.status='ACTIVE' AND s.role_version=ar.version`, digest[:])
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrUnauthorized
	}
	return tx.Commit()
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
