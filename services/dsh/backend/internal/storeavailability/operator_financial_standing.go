package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"net/http"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

// FinancialStanding is the minimum DSH-owned identity of a Store for
// WLT agreement review. It grants no payment, publication or write rights.
type FinancialStanding struct {
	ActorID      string `json:"actorId"`
	StoreID      string `json:"storeId"`
	Relation     string `json:"relation"`
	OwnerActorID string `json:"ownerActorId"`
}

func currentFinanceReviewer(ctx context.Context, identity IdentitySessions, token string) (string, error) {
	if identity == nil {
		return "", ErrIdentityUnavailable
	}
	actor, err := identity.ResolveCurrentSession(ctx, token)
	if err != nil {
		return "", err
	}
	if !identityaccess.ValidActorID(actor.Subject) {
		return "", ErrUnauthorized
	}
	if actor.Role != OperatorRole {
		return "", ErrForbidden
	}
	if err = identity.RequireOperatorPermission(ctx, token, actor.Subject, "finance"); err != nil {
		return "", err
	}
	return actor.Subject, nil
}

func (g *PostgresStoreGrants) readFinancialStanding(ctx context.Context, store string) (FinancialStanding, error) {
	if g == nil || g.db == nil {
		return FinancialStanding{}, ErrStoreOwnerUnavailable
	}
	tx, err := dbscope.Begin(ctx, g.db, g.schema, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead}, "stores")
	if err != nil {
		return FinancialStanding{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	var result FinancialStanding
	err = tx.QueryRowContext(ctx, "SELECT id,relation,owner_actor_id FROM stores WHERE id=$1", store).Scan(&result.StoreID, &result.Relation, &result.OwnerActorID)
	if errors.Is(err, sql.ErrNoRows) {
		return FinancialStanding{}, ErrStoreMissing
	}
	if err != nil || result.StoreID != store || !validRegistrationRelation(result.Relation) || !identityaccess.ValidActorID(result.OwnerActorID) {
		return FinancialStanding{}, ErrStoreOwnerUnavailable
	}
	if err = tx.Commit(); err != nil {
		return FinancialStanding{}, ErrStoreOwnerUnavailable
	}
	return result, nil
}

// NewOperatorFinancialStandingHandler reads the exact Store, published or not,
// after explicit current Finance admission. Reverify the same actor before
// revealing even the existence or absence of the Store.
func NewOperatorFinancialStandingHandler(identity IdentitySessions, grants *PostgresStoreGrants) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		store := r.PathValue("storeID")
		if !registrationPublicID.MatchString(store) || r.URL.RawQuery != "" || r.URL.ForceQuery || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
			writeFailure(w, ErrInvalidChange)
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeFailure(w, ErrUnauthorized)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		actor, err := currentFinanceReviewer(ctx, identity, token)
		if err != nil {
			writeFailure(w, err)
			return
		}
		result, readErr := grants.readFinancialStanding(ctx, store)
		if readErr != nil && !errors.Is(readErr, ErrStoreMissing) {
			writeFailure(w, readErr)
			return
		}
		current, err := currentFinanceReviewer(ctx, identity, token)
		if err != nil {
			writeFailure(w, err)
			return
		}
		if current != actor {
			writeFailure(w, ErrForbidden)
			return
		}
		if ctx.Err() != nil {
			writeFailure(w, ErrStoreOwnerUnavailable)
			return
		}
		if readErr != nil {
			writeFailure(w, readErr)
			return
		}
		result.ActorID = actor
		writeJSON(w, http.StatusOK, result)
	})
}
