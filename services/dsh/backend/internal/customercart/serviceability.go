package customercart

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"net/http"
	"net/url"
	"time"
)

type DeliveryEvidence struct {
	StoreCityID    string  `json:"storeCityId"`
	AddressCityID  string  `json:"addressCityId"`
	AddressVersion int64   `json:"addressVersion"`
	PolicyVersion  int64   `json:"policyVersion"`
	RadiusMetres   int64   `json:"radiusMetres"`
	DistanceMetres float64 `json:"distanceMetres"`
}
type DeliveryServiceability struct {
	ActorID   string            `json:"actorId"`
	StoreID   string            `json:"storeId"`
	AddressID string            `json:"addressId"`
	Status    string            `json:"status"`
	Evidence  *DeliveryEvidence `json:"evidence,omitempty"`
}

// Geographic eligibility only. It neither quotes a fee nor admits a fulfillment mode.
func evaluateDeliveryDistance(storeCity, addressCity string, lat, lon, alat, alon float64, radius int64) (string, float64) {
	valid := func(value, max float64) bool {
		return !math.IsNaN(value) && !math.IsInf(value, 0) && math.Abs(value) <= max
	}
	if storeCity == "" || addressCity == "" || radius <= 0 || !valid(lat, 90) || !valid(alat, 90) || !valid(lon, 180) || !valid(alon, 180) {
		return "UNAVAILABLE", 0
	}
	// Mean earth radius in metres is a geometric constant, not a business limit.
	const earthRadius = 6371008.8
	radians := func(v float64) float64 { return v * math.Pi / 180 }
	a := math.Pow(math.Sin(radians(alat-lat)/2), 2) + math.Cos(radians(lat))*math.Cos(radians(alat))*math.Pow(math.Sin(radians(alon-lon)/2), 2)
	distance := 2 * earthRadius * math.Asin(math.Sqrt(math.Max(0, math.Min(1, a))))
	if storeCity != addressCity || distance > float64(radius) {
		return "UNSERVICEABLE", distance
	}
	return "SERVICEABLE", distance
}
func (h *Handler) deliveryServiceability(w http.ResponseWriter, r *http.Request) {
	store := r.PathValue("storeID")
	params, err := url.ParseQuery(r.URL.RawQuery)
	address := params.Get("addressId")
	if err != nil || r.URL.ForceQuery || len(params) != 1 || len(params["addressId"]) != 1 || !resourceRule.MatchString(store) || !addressIDRule.MatchString(address) || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		fail(w, 400, "INVALID_REQUEST")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	token := tokenOf(r)
	actor, status := h.actor(ctx, token)
	if status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	tx, err := h.begin(ctx, false, "stores", "service_cities", "verticals", "customer_addresses", "service_city_delivery_policies")
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	defer tx.Rollback()
	result, err := readDeliveryServiceability(ctx, tx, actor, store, address)
	if err != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "OWNER_UNAVAILABLE")
		return
	}
	if status = h.stillCurrent(ctx, token, actor); status != 200 {
		fail(w, status, "UNAUTHORIZED_OR_OWNER_UNAVAILABLE")
		return
	}
	reply(w, result)
}

// Both the geographic read and checkout review use this same owner snapshot.
func readDeliveryServiceability(ctx context.Context, tx *sql.Tx, actor, store, address string) (DeliveryServiceability, error) {
	result := DeliveryServiceability{ActorID: actor, StoreID: store, AddressID: address, Status: "UNAVAILABLE"}
	var evidence DeliveryEvidence
	var lat, lon, alat, alon float64
	// The private address join is actor-scoped even for unpublished/unknown Stores.
	// Eligibility uses one owner snapshot; no browsing preference or caller coordinates.
	err := tx.QueryRowContext(ctx, `SELECT s.city_id,a.city_id,a.version,p.version,p.radius_metres,
  s.latitude,s.longitude,a.latitude,a.longitude
  FROM stores s
  JOIN service_cities sc ON sc.id=s.city_id AND sc.active
  JOIN verticals v ON v.id=s.vertical_id AND v.active
  JOIN customer_addresses a ON a.actor_id=$1 AND a.id=$3
  JOIN service_cities ac ON ac.id=a.city_id AND ac.active
  JOIN service_city_delivery_policies p ON p.city_id=s.city_id
  WHERE s.id=$2 AND s.published AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL`, actor, store, address).Scan(
		&evidence.StoreCityID, &evidence.AddressCityID, &evidence.AddressVersion, &evidence.PolicyVersion, &evidence.RadiusMetres, &lat, &lon, &alat, &alon)
	if err == nil {
		result.Status, evidence.DistanceMetres = evaluateDeliveryDistance(evidence.StoreCityID, evidence.AddressCityID, lat, lon, alat, alon, evidence.RadiusMetres)
		if result.Status != "UNAVAILABLE" {
			result.Evidence = &evidence
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return result, err
	}
	return result, nil
}
