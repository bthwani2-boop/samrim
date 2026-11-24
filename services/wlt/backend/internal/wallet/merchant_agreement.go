package wallet

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Only explicit development origins are trusted. Missing configuration denies
// Merchant agreement reads without disabling the existing Customer/Finance API.
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
	} else {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" ||
			u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" ||
			u.String() != origin {
			return "", errors.New("WLT requires the isolated DSH loopback origin")
		}
		port, err := strconv.ParseUint(u.Port(), 10, 16)
		if err != nil || port == 0 {
			return "", errors.New("invalid DSH port")
		}
	}
	return origin + "/v1/stores/mine", nil
}

func ownedStoreRelation(ctx context.Context, identity identityReader, endpoint, auth, actorID, storeID string) (string, int) {
	if endpoint == "" {
		return "", http.StatusServiceUnavailable
	}
	var standing struct {
		ActorID string `json:"actorId"`
		Stores  []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			Relation  string `json:"relation"`
			Published *bool  `json:"published"`
		} `json:"stores"`
	}
	status := identity.readBoundedOwner(ctx, auth, endpoint, &standing, 262144)
	if status != http.StatusOK {
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

func merchantAgreementHandler(identity identityReader, endpoint string, agreement agreementReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		storeID := r.PathValue("storeID")
		if !storeIDRule.MatchString(storeID) {
			failure(w, http.StatusBadRequest, "INVALID_REQUEST")
			return
		}
		// Both ownership and the relation are rechecked around the WLT read.
		// These variables are request-local, never shared between merchants.
		relation := ""
		verify := func(ctx context.Context, auth string) (principal, int) {
			actor, status := identity.readRole(ctx, auth, "merchant")
			if status != http.StatusOK {
				return actor, status
			}
			current, status := ownedStoreRelation(ctx, identity, endpoint, auth, actor.ActorID, storeID)
			if status != http.StatusOK {
				return actor, status
			}
			if relation != "" && relation != current {
				return actor, http.StatusForbidden
			}
			relation = current
			return actor, http.StatusOK
		}
		serveAuthorizedRead(w, r, verify, func(ctx context.Context, _ string) (any, error) {
			if agreement == nil {
				return nil, errors.New("agreement read unavailable")
			}
			result, err := agreement(ctx, storeID)
			if err != nil {
				return nil, err
			}
			if result.StoreID != storeID || (result.Proposal != nil && result.Proposal.Relation != relation) {
				return nil, errors.New("agreement owner relation mismatch")
			}
			return result, nil
		}, false)
	}
}
