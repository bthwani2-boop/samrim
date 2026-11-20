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
	auth := "Bearer " + token
	if !sandboxReference.MatchString(reference) || amount < 1 || !validBearer(auth) {
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
	if err := tx.QueryRowContext(ctx, "SELECT wlt.post_sandbox_customer_funding($1, $2, $3)",
		reference, actor.ActorID, amount).Scan(&state); err != nil {
		return "", errSandboxUnconfirmed
	}
	switch state {
	case "CONFLICT":
		return "", errors.New("sandbox reference conflicts with an existing posting")
	case "POSTED", "REPLAYED":
	default:
		return "", errSandboxUnconfirmed
	}
	current, status := identity.read(ctx, auth)
	if status != http.StatusOK || current.ActorID != actor.ActorID || !actor.Expires.After(time.Now()) {
		return "", errors.New("sandbox funding requires a current Customer session")
	}
	if err := tx.Commit(); err != nil {
		return "", errSandboxUnconfirmed
	}
	return state, nil
}
