package storeavailability

import (
	"context"
	"database/sql"
	"net/http"
	"time"
)

// CityDeliveryPolicy is the same effective radius/version used by checkout.
type CityDeliveryPolicy struct {
	CityID       string    `json:"cityId"`
	Version      int64     `json:"version"`
	RadiusMetres int64     `json:"radiusMetres"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
type CityDeliveryPolicyReader interface {
	ReadCityDeliveryPolicy(context.Context, string) (CityDeliveryPolicy, error)
}

func (source *PostgresPolicySource) ReadCityDeliveryPolicy(ctx context.Context, city string) (CityDeliveryPolicy, error) {
	if !cityPolicyIDRule.MatchString(city) {
		return CityDeliveryPolicy{}, ErrInvalidChange
	}
	if source == nil || source.db == nil {
		return CityDeliveryPolicy{}, ErrPolicyUnavailable
	}
	tx, err := beginScopedStoreTx(ctx, source.db, source.schema, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return CityDeliveryPolicy{}, ErrPolicyUnavailable
	}
	defer tx.Rollback()
	var p CityDeliveryPolicy
	err = tx.QueryRowContext(ctx, `SELECT p.city_id,p.version,p.radius_metres,p.updated_at
 FROM service_city_delivery_policies p JOIN service_cities c ON c.id=p.city_id
 WHERE c.id=$1 AND c.active`, city).Scan(&p.CityID, &p.Version, &p.RadiusMetres, &p.UpdatedAt)
	if err != nil || p.CityID != city || p.Version < 1 || p.Version > 9007199254740991 || p.RadiusMetres <= 0 || p.UpdatedAt.IsZero() {
		return CityDeliveryPolicy{}, ErrPolicyUnavailable
	}
	if tx.Commit() != nil {
		return CityDeliveryPolicy{}, ErrPolicyUnavailable
	}
	p.UpdatedAt = p.UpdatedAt.UTC()
	return p, nil
}
func cityDeliveryPolicyHandler(identity IdentitySessions, reader CityDeliveryPolicyReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.ContentLength != 0 || len(r.TransferEncoding) != 0 || r.URL.ForceQuery {
			writeFailure(w, ErrInvalidChange)
			return
		}
		actor, ok := authorizeCityPolicyOperator(w, r, identity)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		p, err := reader.ReadCityDeliveryPolicy(ctx, r.PathValue("cityID"))
		if err != nil {
			writeFailure(w, err)
			return
		}
		current, ok := authorizeCityPolicyOperator(w, r, identity)
		if !ok {
			return
		}
		if actor != current {
			writeFailure(w, ErrForbidden)
			return
		}
		if p.CityID != r.PathValue("cityID") {
			writeFailure(w, ErrPolicyUnavailable)
			return
		}
		writeJSON(w, http.StatusOK, p)
	}
}
