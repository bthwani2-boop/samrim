package storeavailability

import (
	"errors"
	"mime"
	"net/http"
	"strings"
)

// NewCityPolicyHandler exposes DSH city policy read and, only when a DSH
// writer is supplied, a versioned full-replacement command. Both operations
// require the same current Identity Operator/platform_policies authority.
func NewCityPolicyHandler(identity IdentitySessions, policies CityPolicyReader, writers ...CityPolicyWriter) (http.Handler, error) {
	if identity == nil {
		return nil, ErrUnauthorized
	}
	if policies == nil || len(writers) > 1 || (len(writers) == 1 && writers[0] == nil) {
		return nil, ErrPolicyUnavailable
	}
	var writer CityPolicyWriter
	if len(writers) == 1 {
		writer = writers[0]
	}
	mux := http.NewServeMux()
	path := "/v1/operators/cities/{cityID}/store-availability-policy"
	mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		// Go ServeMux implicitly treats HEAD as GET; this contract is GET only.
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		actor, ok := authorizeCityPolicyOperator(w, r, identity)
		if !ok {
			return
		}
		_ = actor
		current, err := policies.ReadCityPolicy(r.Context(), r.PathValue("cityID"))
		if err != nil {
			writeFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, current)
	})
	if history, ok := policies.(CityPolicyHistoryReader); ok {
		mux.HandleFunc("GET "+path+"/history", cityPolicyHistoryHandler(identity, history))
	}
	if writer != nil {
		mux.HandleFunc("PATCH "+path, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			actorID, ok := authorizeCityPolicyOperator(w, r, identity)
			if !ok {
				return
			}
			media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || media != "application/json" {
				writeFailure(w, ErrInvalidChange)
				return
			}
			var input struct {
				OperationID           string `json:"operationId"`
				ExpectedVersion       *int64 `json:"expectedVersion"`
				MaxPauseSeconds       *int   `json:"maxPauseSeconds"`
				MaxPreparationMinutes *int   `json:"maxPreparationMinutes"`
				Reason                string `json:"reason"`
			}
			if decodeUniqueJSON(w, r, 8*1024, &input) != nil ||
				input.ExpectedVersion == nil || input.MaxPauseSeconds == nil || input.MaxPreparationMinutes == nil {
				writeFailure(w, ErrInvalidChange)
				return
			}
			change := CityPolicyChange{
				CityID: r.PathValue("cityID"), OperationID: input.OperationID,
				ExpectedVersion:       *input.ExpectedVersion,
				MaxPauseSeconds:       *input.MaxPauseSeconds,
				MaxPreparationMinutes: *input.MaxPreparationMinutes,
				Reason:                input.Reason,
			}
			if !validCityPolicyChange(change) {
				writeFailure(w, ErrInvalidChange)
				return
			}
			result, replay, err := writer.ApplyCityPolicy(r.Context(), actorID, change)
			if err != nil {
				writeFailure(w, err)
				return
			}
			writeJSON(w, http.StatusOK, struct {
				Policy CityPolicy `json:"policy"`
				Replay bool       `json:"replay"`
			}{Policy: result, Replay: replay})
		})
	}
	return mux, nil
}

func authorizeCityPolicyOperator(w http.ResponseWriter, r *http.Request, identity IdentitySessions) (string, bool) {
	return authorizePolicyOperator(w, r, identity, r.URL.RawQuery == "")
}

// queryAllowed is determined at the endpoint boundary: writes reject all
// selectors, while history reads accept only validated pagination selectors.
func authorizePolicyOperator(w http.ResponseWriter, r *http.Request, identity IdentitySessions, queryAllowed bool) (string, bool) {
	token, ok := bearerToken(r)
	if !ok {
		writeFailure(w, ErrUnauthorized)
		return "", false
	}
	if !queryAllowed || !cityPolicyIDRule.MatchString(r.PathValue("cityID")) {
		writeFailure(w, ErrInvalidChange)
		return "", false
	}
	actor, err := identity.ResolveCurrentSession(r.Context(), token)
	if err != nil {
		if errors.Is(err, ErrIdentityUnavailable) {
			writeFailure(w, ErrIdentityUnavailable)
		} else {
			writeFailure(w, ErrUnauthorized)
		}
		return "", false
	}
	if actor.Role != OperatorRole || actor.Subject == "" || strings.TrimSpace(actor.Subject) != actor.Subject {
		writeFailure(w, ErrForbidden)
		return "", false
	}
	if err = identity.RequireOperatorPermission(r.Context(), token, actor.Subject, "platform_policies"); err != nil {
		switch {
		case errors.Is(err, ErrIdentityUnavailable):
			writeFailure(w, ErrIdentityUnavailable)
		case errors.Is(err, ErrUnauthorized):
			writeFailure(w, ErrUnauthorized)
		default:
			writeFailure(w, ErrForbidden)
		}
		return "", false
	}
	return actor.Subject, true
}
