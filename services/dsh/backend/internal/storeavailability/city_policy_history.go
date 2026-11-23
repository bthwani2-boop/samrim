package storeavailability

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
)

// History is the existing DSH immutable audit, including inactive cities;
// viewing a past policy does not admit any current operation.
type CityPolicyHistoryPage struct {
	CityID            string       `json:"cityId"`
	Entries           []CityPolicy `json:"entries"`
	NextBeforeVersion string       `json:"nextBeforeVersion,omitempty"`
}

type CityPolicyHistoryReader interface {
	ReadCityPolicyHistory(context.Context, string, int, int64) (CityPolicyHistoryPage, error)
}

func (source *PostgresPolicySource) ReadCityPolicyHistory(ctx context.Context, city string, limit int, before int64) (CityPolicyHistoryPage, error) {
	if !cityPolicyIDRule.MatchString(city) || limit < 1 || limit > 50 || before < 0 {
		return CityPolicyHistoryPage{}, ErrInvalidChange
	}
	if source == nil || source.db == nil {
		return CityPolicyHistoryPage{}, ErrPolicyUnavailable
	}
	tx, err := beginScopedStoreTx(ctx, source.db, source.schema, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return CityPolicyHistoryPage{}, ErrPolicyUnavailable
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT city_id,version,max_pause_seconds,max_preparation_minutes,
 acting_actor_id,reason,changed_at FROM store_operational_limits_audit
 WHERE city_id=$1 AND ($2::bigint=0 OR version<$2)
 ORDER BY version DESC LIMIT $3`, city, before, limit+1)
	if err != nil {
		return CityPolicyHistoryPage{}, ErrPolicyUnavailable
	}
	defer rows.Close()
	page := CityPolicyHistoryPage{CityID: city, Entries: make([]CityPolicy, 0, limit)}
	for rows.Next() {
		var entry CityPolicy
		if err = rows.Scan(&entry.CityID, &entry.Version, &entry.MaxPauseSeconds, &entry.MaxPreparationMinutes, &entry.ChangedByActor, &entry.ChangeReason, &entry.UpdatedAt); err != nil {
			return CityPolicyHistoryPage{}, ErrPolicyUnavailable
		}
		if len(page.Entries) == limit {
			page.NextBeforeVersion = strconv.FormatInt(page.Entries[len(page.Entries)-1].Version, 10)
			break
		}
		entry.UpdatedAt = entry.UpdatedAt.UTC()
		page.Entries = append(page.Entries, entry)
	}
	if rows.Err() != nil || rows.Close() != nil {
		return CityPolicyHistoryPage{}, ErrPolicyUnavailable
	}
	if err = tx.Commit(); err != nil {
		return CityPolicyHistoryPage{}, ErrPolicyUnavailable
	}
	return page, nil
}

func cityPolicyHistoryHandler(identity IdentitySessions, reader CityPolicyHistoryReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		limit, before, ok := policyHistoryParams(r.URL.RawQuery)
		if !ok {
			writeFailure(w, ErrInvalidChange)
			return
		}
		authRequest := r.Clone(r.Context())
		cleanURL := *r.URL
		cleanURL.RawQuery = ""
		authRequest.URL = &cleanURL
		actor, ok := authorizeCityPolicyOperator(w, authRequest, identity)
		if !ok {
			return
		}
		page, err := reader.ReadCityPolicyHistory(r.Context(), r.PathValue("cityID"), limit, before)
		if err != nil {
			writeFailure(w, err)
			return
		}
		current, ok := authorizeCityPolicyOperator(w, authRequest, identity)
		if !ok {
			return
		}
		if actor != current {
			writeFailure(w, ErrForbidden)
			return
		}
		writeJSON(w, http.StatusOK, page)
	}
}
