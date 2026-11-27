package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"mime"
	"net/http"
	"time"
)

// CityDeliveryPolicy carries the effective radius/version used by checkout.
// A zero version is an internal absence marker for a verified active city, not a usable policy.
type CityDeliveryPolicy struct {
	CityID        string         `json:"cityId"`
	Version       int64          `json:"version"`
	RadiusMetres  int64          `json:"radiusMetres"`
	UpdatedAt     time.Time      `json:"updatedAt"`
	DistanceBands []DistanceBand `json:"distanceBands,omitempty"`
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
	tx, err := dbscope.Begin(ctx, source.db, source.schema, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead}, "service_cities", "service_city_delivery_policies")
	if err != nil {
		return CityDeliveryPolicy{}, ErrPolicyUnavailable
	}
	defer tx.Rollback()
	var p CityDeliveryPolicy
	var raw []byte
	var exists bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM service_city_delivery_policies WHERE city_id=c.id) FROM service_cities c WHERE c.id=$1 AND c.active", city).Scan(&exists); err != nil {
		return CityDeliveryPolicy{}, ErrPolicyUnavailable
	}
	if !exists {
		if tx.Commit() != nil {
			return CityDeliveryPolicy{}, ErrPolicyUnavailable
		}
		return CityDeliveryPolicy{CityID: city}, nil
	}
	err = tx.QueryRowContext(ctx, `SELECT p.city_id,p.version,p.radius_metres,p.updated_at,p.distance_bands
 FROM service_city_delivery_policies p JOIN service_cities c ON c.id=p.city_id
 WHERE c.id=$1 AND c.active`, city).Scan(&p.CityID, &p.Version, &p.RadiusMetres, &p.UpdatedAt, &raw)
	if err != nil || p.CityID != city || p.Version < 1 || p.Version > 9007199254740991 || p.RadiusMetres <= 0 || p.UpdatedAt.IsZero() {
		return CityDeliveryPolicy{}, ErrPolicyUnavailable
	}
	if len(raw) != 0 {
		var ok bool
		p.DistanceBands, ok = DecodeDistanceBands(raw)
		if !ok {
			return CityDeliveryPolicy{}, ErrPolicyUnavailable
		}
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
		if p.Version == 0 {
			if p.RadiusMetres != 0 || !p.UpdatedAt.IsZero() || p.DistanceBands != nil {
				writeFailure(w, ErrPolicyUnavailable)
				return
			}
			writeJSON(w, http.StatusOK, struct {
				CityID  string `json:"cityId"`
				Version int64  `json:"version"`
			}{p.CityID, 0})
			return
		}
		writeJSON(w, http.StatusOK, p)
	}
}

func cityDeliveryPolicyPreviewHandler(identity IdentitySessions, reader CityDeliveryPolicyReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		actor, ok := authorizeCityPolicyOperator(w, r, identity)
		if !ok {
			return
		}
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/json" {
			writeFailure(w, ErrInvalidChange)
			return
		}
		var input struct {
			ExpectedVersion *int64          `json:"expectedVersion"`
			RadiusMetres    *int64          `json:"radiusMetres"`
			DistanceMetres  *int64          `json:"distanceMetres"`
			DistanceBands   json.RawMessage `json:"distanceBands"`
		}
		if decodeUniqueJSON(w, r, 8*1024, &input) != nil || input.ExpectedVersion == nil || *input.ExpectedVersion < 0 || *input.ExpectedVersion > 9007199254740991 ||
			input.RadiusMetres == nil || *input.RadiusMetres < 1 || *input.RadiusMetres > 2147483647 ||
			input.DistanceMetres == nil || *input.DistanceMetres < 0 || *input.DistanceMetres > *input.RadiusMetres {
			writeFailure(w, ErrInvalidChange)
			return
		}
		fee, ok := DistanceBandFee(*input.DistanceMetres, input.DistanceBands)
		if !ok {
			writeFailure(w, ErrInvalidChange)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		city := r.PathValue("cityID")
		current, err := reader.ReadCityDeliveryPolicy(ctx, city)
		if err != nil {
			writeFailure(w, err)
			return
		}
		if current.CityID != city {
			writeFailure(w, ErrPolicyUnavailable)
			return
		}
		if current.Version != *input.ExpectedVersion {
			writeFailure(w, ErrPolicyVersionConflict)
			return
		}
		currentActor, ok := authorizeCityPolicyOperator(w, r, identity)
		if !ok {
			return
		}
		if currentActor != actor {
			writeFailure(w, ErrForbidden)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			CityID         string `json:"cityId"`
			Version        int64  `json:"version"`
			RadiusMetres   int64  `json:"radiusMetres"`
			DistanceMetres int64  `json:"distanceMetres"`
			FeeYER         string `json:"feeYer"`
			Payable        bool   `json:"payable"`
		}{city, current.Version, *input.RadiusMetres, *input.DistanceMetres, fee, false})
	}
}
