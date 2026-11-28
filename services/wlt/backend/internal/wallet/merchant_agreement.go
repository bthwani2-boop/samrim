package wallet

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// Only admitted owner endpoints participate in Merchant financial evidence.
// Missing configuration denies this read without changing other wallet routes.
func merchantStandingEndpoint(containerMode bool, origins []string) (string, error) {
	if len(origins) == 0 || (len(origins) == 1 && origins[0] == "") {
		return "", nil
	}
	if len(origins) != 1 {
		return "", errors.New("ambiguous DSH origin")
	}
	origin := origins[0]
	if containerMode {
		if origin != "http://dsh:8080" {
			return "", errors.New("WLT requires the isolated DSH service origin")
		}
	} else if !validLoopbackOwnerOrigin(origin) {
		return "", errors.New("WLT requires the isolated DSH loopback origin")
	}
	return origin + "/v1/stores/mine", nil
}

type merchantStoreStanding struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Relation  string `json:"relation"`
	Published *bool  `json:"published"`
}

type merchantStanding struct {
	ActorID string                  `json:"actorId"`
	Stores  []merchantStoreStanding `json:"stores"`
}

// DSH owns the complete Store directory, including unpublished Stores.
// Validate the whole projection before accepting any selected relation.
func ownedStoreRelation(ctx context.Context, identity identityReader, endpoint, auth, actorID, storeID string) (string, int) {
	if endpoint == "" || !storeIDRule.MatchString(storeID) {
		return "", http.StatusServiceUnavailable
	}
	var standing merchantStanding
	if status := identity.readBoundedOwner(ctx, auth, endpoint, &standing, 262144); status != http.StatusOK {
		return "", status
	}
	if standing.ActorID != actorID || standing.Stores == nil || len(standing.Stores) > 100 {
		return "", http.StatusServiceUnavailable
	}
	seen := make(map[string]bool, len(standing.Stores))
	relation := ""
	for _, store := range standing.Stores {
		if !storeIDRule.MatchString(store.ID) || seen[store.ID] ||
			strings.TrimSpace(store.Name) == "" || utf8.RuneCountInString(store.Name) > 120 ||
			(store.Relation != "DIRECT" && store.Relation != "MARKETPLACE") || store.Published == nil {
			return "", http.StatusServiceUnavailable
		}
		seen[store.ID] = true
		if store.ID == storeID {
			relation = store.Relation
		}
	}
	if relation == "" {
		return "", http.StatusForbidden
	}
	return relation, http.StatusOK
}

// Each authority observation brackets the DSH call with Identity reads.
// A delayed successful standing response cannot revive a revoked or replaced
// session. The outer read boundary compares the two observations around WLT.
type merchantAgreementAuthority struct {
	identity identityReader
	endpoint string
	storeID  string
	relation string
}

func (a *merchantAgreementAuthority) verify(ctx context.Context, auth string) (principal, int) {
	actor, status := a.identity.readRole(ctx, auth, "merchant")
	if status != http.StatusOK {
		return principal{}, status
	}
	relation, status := ownedStoreRelation(ctx, a.identity, a.endpoint, auth, actor.ActorID, a.storeID)
	if status != http.StatusOK {
		return principal{}, status
	}
	current, status := a.identity.readRole(ctx, auth, "merchant")
	if status != http.StatusOK {
		return principal{}, status
	}
	if ctx.Err() != nil {
		return principal{}, http.StatusServiceUnavailable
	}
	now := time.Now()
	if current.ActorID != actor.ActorID || !actor.Expires.After(now) || !current.Expires.After(now) {
		return principal{}, http.StatusUnauthorized
	}
	if a.relation != "" && a.relation != relation {
		return principal{}, http.StatusForbidden
	}
	a.relation = relation
	return current, http.StatusOK
}

func (a *merchantAgreementAuthority) read(ctx context.Context, agreement agreementReader) (any, error) {
	if agreement == nil || a.relation == "" {
		return nil, errors.New("agreement read unavailable")
	}
	result, err := agreement(ctx, a.storeID)
	if err != nil {
		return nil, err
	}
	if result.StoreID != a.storeID || (result.Proposal != nil && result.Proposal.Relation != a.relation) {
		return nil, errors.New("agreement owner relation mismatch")
	}
	return result, nil
}

func merchantAgreementHandler(identity identityReader, endpoint string, agreement agreementReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		storeID := r.PathValue("storeID")
		if !storeIDRule.MatchString(storeID) {
			failure(w, http.StatusBadRequest, "INVALID_REQUEST")
			return
		}
		// One request-local observation, never retained across actors or Stores.
		authority := merchantAgreementAuthority{identity: identity, endpoint: endpoint, storeID: storeID}
		serveAuthorizedRead(w, r, authority.verify, func(ctx context.Context, _ string) (any, error) {
			return authority.read(ctx, agreement)
		}, false)
	}
}
