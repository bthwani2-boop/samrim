package wallet

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"time"
)

var sandboxReference = regexp.MustCompile(`^[a-z0-9-]{8,64}$`)
var errSandboxUnconfirmed = errors.New("sandbox posting unconfirmed; retry with the same reference and payload")

// PostSandboxFunding exercises the existing journal through a dedicated
// PostgreSQL role in the disposable database. The reference identifies a
// synthetic event and must be reused with the same payload after interruption.
func PostSandboxFunding(ctx context.Context, db *sql.DB, origin, token, reference string, amount int64) (string, error) {
	if amount < 1 {
		return "", errors.New("invalid sandbox funding amount")
	}
	return writeSandboxFunding(ctx, db, origin, token, reference, "", sandboxPosting, amount)
}

func ReverseSandboxFunding(ctx context.Context, db *sql.DB, origin, token, reference string) (string, error) {
	return writeSandboxFunding(ctx, db, origin, token, reference, "", sandboxReversal)
}

// Verify the actual transaction principal, not just the connection URL. This
// does not grant privileges or authorize any new financial operation.
func checkSandboxDatabase(ctx context.Context, tx *sql.Tx) error {
	var safe bool
	err := tx.QueryRowContext(ctx, `SELECT current_database() = 'bthwani_wlt_test'
		AND current_user = 'bthwani_wlt_sandbox' AND session_user = current_user
		AND rolcanlogin AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
		AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = sandbox.oid)
		AND NOT has_database_privilege(current_database(), 'CREATE')
		AND has_schema_privilege('wlt', 'USAGE')
		AND NOT has_schema_privilege('wlt', 'CREATE,USAGE WITH GRANT OPTION')
		AND has_function_privilege('wlt.post_sandbox_customer_funding(text,text,bigint)'::regprocedure, 'EXECUTE')
		AND has_function_privilege('wlt.reverse_sandbox_customer_funding(text,text)'::regprocedure, 'EXECUTE')
		AND NOT EXISTS (
			SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
			WHERE n.nspname='wlt'
			AND (p.proowner=sandbox.oid OR has_function_privilege(p.oid,'EXECUTE WITH GRANT OPTION')
				OR (p.prorettype NOT IN ('pg_catalog.trigger'::regtype,'pg_catalog.event_trigger'::regtype)
					AND p.oid NOT IN ('wlt.post_sandbox_customer_funding(text,text,bigint)'::regprocedure,
					'wlt.reverse_sandbox_customer_funding(text,text)'::regprocedure)
					AND has_function_privilege(p.oid,'EXECUTE')))
		)
		AND NOT EXISTS (
			SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
			WHERE n.nspname='wlt' AND c.relkind IN ('r','p','v','m','f')
			AND (c.relowner=sandbox.oid
				OR has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
				OR has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
		)
		FROM pg_roles sandbox WHERE rolname=current_user`).Scan(&safe)
	if err != nil || !safe {
		return errors.New("sandbox funding database role is not admitted")
	}
	return nil
}

const (
	sandboxPosting  = "SELECT wlt.post_sandbox_customer_funding($1, $2, $3)"
	sandboxReversal = "SELECT wlt.reverse_sandbox_customer_funding($1, $2)"
)

func writeSandboxFunding(ctx context.Context, db *sql.DB, origin, token, reference, expectedActor, statement string, values ...any) (string, error) {
	auth := "Bearer " + token
	if !sandboxReference.MatchString(reference) || !validBearer(auth) {
		return "", errors.New("invalid sandbox funding input")
	}
	identity, err := newIdentityReader(origin)
	if err != nil {
		return "", err
	}
	actor, status := identity.read(ctx, auth)
	if status != http.StatusOK {
		return "", errors.New("sandbox funding requires a current Customer session")
	}
	if expectedActor != "" && actor.ActorID != expectedActor {
		return "", errors.New("sandbox funding provider actor changed")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", errSandboxUnconfirmed
	}
	defer tx.Rollback()
	if err := checkSandboxDatabase(ctx, tx); err != nil {
		return "", err
	}
	var state string
	args := append([]any{reference, actor.ActorID}, values...)
	if err := tx.QueryRowContext(ctx, statement, args...).Scan(&state); err != nil {
		return "", errSandboxUnconfirmed
	}
	switch state {
	case "CONFLICT":
		return "", errors.New("sandbox reference conflicts with an existing posting")
	case "UNAVAILABLE":
		return "", errors.New("original sandbox funding unavailable for this Customer")
	case "POSTED", "REVERSED", "REPLAYED":
	default:
		return "", errSandboxUnconfirmed
	}
	current, status := identity.read(ctx, auth)
	now := time.Now()
	if status != http.StatusOK || current.ActorID != actor.ActorID || !actor.Expires.After(now) || !current.Expires.After(now) {
		return "", errors.New("sandbox funding requires a current Customer session")
	}
	if err := tx.Commit(); err != nil {
		return "", errSandboxUnconfirmed
	}
	return state, nil
}
