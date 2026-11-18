package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// MerchantStore is the DSH owner's current business standing for a Store.
// It does not imply publication, payout rights, or an Operator permission.
type MerchantStore struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Relation  string `json:"relation"`
	Published bool   `json:"published"`
}
type MerchantStoreStanding struct {
	ActorID string          `json:"actorId"`
	Stores  []MerchantStore `json:"stores"`
}

// Only DSH's canonical store-owner database may answer this query. A
// missing lister fails closed rather than synthesizing a Store from Identity.
type MerchantStoreLister interface {
	ListOwnedMerchantStores(context.Context, string) ([]MerchantStore, error)
}

func (s *Service) ListMerchantStores(ctx context.Context, token string) (MerchantStoreStanding, error) {
	if s == nil || s.identity == nil || token == "" || strings.TrimSpace(token) != token {
		return MerchantStoreStanding{}, ErrUnauthorized
	}
	actor, err := s.identity.ResolveCurrentSession(ctx, token)
	if errors.Is(err, ErrIdentityUnavailable) {
		return MerchantStoreStanding{}, ErrIdentityUnavailable
	}
	if err != nil || actor.Subject == "" || strings.TrimSpace(actor.Subject) != actor.Subject {
		return MerchantStoreStanding{}, ErrUnauthorized
	}
	if actor.Role != MerchantRole {
		return MerchantStoreStanding{}, ErrForbidden
	}
	reader, ok := s.grants.(MerchantStoreLister)
	if !ok {
		return MerchantStoreStanding{}, ErrStoreOwnerUnavailable
	}
	stores, err := reader.ListOwnedMerchantStores(ctx, actor.Subject)
	if err != nil {
		return MerchantStoreStanding{}, ErrStoreOwnerUnavailable
	}
	if stores == nil {
		stores = []MerchantStore{}
	}
	return MerchantStoreStanding{ActorID: actor.Subject, Stores: stores}, nil
}

// ListOwnedMerchantStores reads *only* the rows owned by the verified actor.
// It uses the established DSH schema-bound read transaction and a hard upper
// bound; oversized results fail closed, never silently hide authority.
func (g *PostgresStoreGrants) ListOwnedMerchantStores(ctx context.Context, actorID string) ([]MerchantStore, error) {
	if g == nil || g.db == nil || actorID == "" || strings.TrimSpace(actorID) != actorID {
		return nil, ErrForbidden
	}
	tx, err := beginScopedStoreTx(ctx, g.db, g.schema, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,name,relation,published FROM stores
        WHERE owner_actor_id=$1 ORDER BY id LIMIT 101`, actorID)
	if err != nil {
		return nil, err
	}
	stores := make([]MerchantStore, 0)
	for rows.Next() {
		if len(stores) >= 100 {
			rows.Close()
			return nil, ErrStoreOwnerUnavailable
		}
		var store MerchantStore
		if err = rows.Scan(&store.ID, &store.Name, &store.Relation, &store.Published); err != nil {
			rows.Close()
			return nil, err
		}
		stores = append(stores, store)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return stores, nil
}
