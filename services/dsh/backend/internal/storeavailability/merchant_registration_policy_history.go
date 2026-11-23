package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"
)

// Registration policy audit is sourced exclusively from immutable DSH commands.
// Versions predating the audit migration are not manufactured as historical events.
type StoreRegistrationPolicyHistoryEntry struct {
	Version        int64     `json:"version"`
	Enabled        bool      `json:"enabled"`
	TermsVersion   string    `json:"termsVersion"`
	ChangedByActor string    `json:"changedByActor"`
	ChangeReason   string    `json:"changeReason"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type StoreRegistrationPolicyHistoryPage struct {
	Entries           []StoreRegistrationPolicyHistoryEntry `json:"entries"`
	NextBeforeVersion string                                `json:"nextBeforeVersion,omitempty"`
}

var policyPositiveDecimal = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)

func policyHistoryParams(raw string) (limit int, before int64, ok bool) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return 0, 0, false
	}
	limit = 20
	for key, entries := range values {
		if len(entries) != 1 || (key != "limit" && key != "beforeVersion") {
			return 0, 0, false
		}
		entry := entries[0]
		if !policyPositiveDecimal.MatchString(entry) {
			return 0, 0, false
		}
		number, parseErr := strconv.ParseInt(entry, 10, 64)
		if parseErr != nil {
			return 0, 0, false
		}
		if key == "limit" {
			if number > 50 {
				return 0, 0, false
			}
			limit = int(number)
		} else {
			before = number
		}
	}
	return limit, before, true
}

func (s *MerchantStoreRegistrar) ReadRegistrationPolicyHistory(
	ctx context.Context, cityID, relation string, limit int, before int64,
) (StoreRegistrationPolicyHistoryPage, error) {
	if !registrationPublicID.MatchString(cityID) || !validRegistrationRelation(relation) ||
		limit < 1 || limit > 50 || before < 0 {
		return StoreRegistrationPolicyHistoryPage{}, ErrRegistrationInvalid
	}
	tx, err := beginScopedStoreTx(ctx, s.grants.db, s.grants.schema,
		&sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return StoreRegistrationPolicyHistoryPage{}, ErrStoreOwnerUnavailable
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT c.result_version,c.enabled,c.terms_version,
			c.actor_id,c.change_reason,c.applied_at
		FROM store_registration_policy_commands c
		WHERE c.city_id=$1 AND c.relation=$2
		  AND ($3::bigint=0 OR c.result_version<$3)
		ORDER BY c.result_version DESC LIMIT $4`, cityID, relation, before, limit+1)
	if err != nil {
		return StoreRegistrationPolicyHistoryPage{}, ErrStoreOwnerUnavailable
	}
	result := StoreRegistrationPolicyHistoryPage{
		Entries: make([]StoreRegistrationPolicyHistoryEntry, 0, limit),
	}
	for rows.Next() {
		var entry StoreRegistrationPolicyHistoryEntry
		if err = rows.Scan(&entry.Version, &entry.Enabled, &entry.TermsVersion,
			&entry.ChangedByActor, &entry.ChangeReason, &entry.UpdatedAt); err != nil {
			break
		}
		if len(result.Entries) < limit {
			entry.UpdatedAt = entry.UpdatedAt.UTC()
			result.Entries = append(result.Entries, entry)
		} else {
			result.NextBeforeVersion = strconv.FormatInt(result.Entries[len(result.Entries)-1].Version, 10)
			break
		}
	}
	scanErr := rows.Err()
	closeErr := rows.Close()
	if err != nil || scanErr != nil || closeErr != nil {
		return StoreRegistrationPolicyHistoryPage{}, ErrStoreOwnerUnavailable
	}
	if err = tx.Commit(); err != nil {
		return StoreRegistrationPolicyHistoryPage{}, ErrStoreOwnerUnavailable
	}
	return result, nil
}

func storeRegistrationPolicyHistoryHandler(s *MerchantStoreRegistrar) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		limit, before, ok := policyHistoryParams(r.URL.RawQuery)
		if !ok || !registrationPublicID.MatchString(r.PathValue("cityID")) ||
			!validRegistrationRelation(r.PathValue("relation")) {
			writeRegistrationFailure(w, ErrRegistrationInvalid)
			return
		}
		// The shared Operator authorizer rejects *any* query as part of its
		// write-policy boundary. The read-only audit endpoint validates the
		// only permitted pagination selectors first, then authorizes the
		// identical bearer, city and relation with no raw query attached.
		authRequest := r.Clone(r.Context())
		cleanURL := *r.URL
		cleanURL.RawQuery = ""
		authRequest.URL = &cleanURL
		actor, allowed := authorizeCityPolicyOperator(w, authRequest, s.identity)
		if !allowed {
			return
		}
		result, err := s.ReadRegistrationPolicyHistory(r.Context(),
			r.PathValue("cityID"), r.PathValue("relation"), limit, before)
		if err != nil {
			if errors.Is(err, ErrRegistrationInvalid) {
				writeRegistrationFailure(w, err)
			} else {
				writeFailure(w, err)
			}
			return
		}
		current, allowed := authorizeCityPolicyOperator(w, authRequest, s.identity)
		if !allowed {
			return
		}
		if current != actor {
			writeFailure(w, ErrForbidden)
			return
		}
		writeJSON(w, http.StatusOK, result)
	}
}
