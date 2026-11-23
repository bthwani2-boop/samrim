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
	return writeSandboxFunding(ctx, db, origin, token, reference, sandboxPosting, amount)
}

func ReverseSandboxFunding(ctx context.Context, db *sql.DB, origin, token, reference string) (string, error) {
	return writeSandboxFunding(ctx, db, origin, token, reference, sandboxReversal)
}

const (
	sandboxPosting  = "SELECT wlt.post_sandbox_customer_funding($1, $2, $3)"
	sandboxReversal = "SELECT wlt.reverse_sandbox_customer_funding($1, $2)"
)

func writeSandboxFunding(ctx context.Context, db *sql.DB, origin, token, reference, statement string, values ...any) (string, error) {
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
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", errSandboxUnconfirmed
	}
	defer tx.Rollback()
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
