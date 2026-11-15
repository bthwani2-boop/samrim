package storeavailability

import (
	"errors"
	"net/http"
)

// NewCityPolicyHandler exposes only versioned, DSH-owned policy readback.
// It never provisions policy, changes Store rights, or grants any capability
// from the Operator role alone. Mount only on the isolated private DSH host.
func NewCityPolicyHandler(identity IdentitySessions, policies CityPolicyReader) (http.Handler, error) {
	if identity == nil {
		return nil, ErrUnauthorized
	}
	if policies == nil {
		return nil, ErrPolicyUnavailable
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/operators/cities/{cityID}/store-availability-policy", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		// Go ServeMux treats HEAD as GET. This private contract is exact GET
		// only; reject implicit methods before reading Identity or DSH.
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeFailure(w, ErrUnauthorized)
			return
		}
		actor, err := identity.ResolveCurrentSession(r.Context(), token)
		if err != nil {
			if errors.Is(err, ErrIdentityUnavailable) {
				writeFailure(w, ErrIdentityUnavailable)
			} else {
				writeFailure(w, ErrUnauthorized)
			}
			return
		}
		if actor.Role != OperatorRole || actor.Subject == "" {
			writeFailure(w, ErrForbidden)
			return
		}
		if err = identity.RequireOperatorPermission(r.Context(), token, actor.Subject, "platform_policies"); err != nil {
			switch {
			case errors.Is(err, ErrIdentityUnavailable):
				writeFailure(w, ErrIdentityUnavailable)
			case errors.Is(err, ErrUnauthorized):
				writeFailure(w, ErrUnauthorized)
			default:
				// Denied, unrecognized or missing current Identity permissions
				// never become successful Operator policy access.
				writeFailure(w, ErrForbidden)
			}
			return
		}
		if r.URL.RawQuery != "" || !cityPolicyIDRule.MatchString(r.PathValue("cityID")) {
			writeFailure(w, ErrInvalidChange)
			return
		}
		current, err := policies.ReadCityPolicy(r.Context(), r.PathValue("cityID"))
		if err != nil {
			writeFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, current)
	})
	return mux, nil
}
