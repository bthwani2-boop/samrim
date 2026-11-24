package customercart

import (
	"context"
	"database/sql"
	"math"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

// DistanceFeeEstimate is advisory, not a payable quote, WLT authorization or
// fulfillment admission. The geographic evidence and bands share one DSH version.
type DistanceFeeEstimate struct {
	PolicyVersion  int64  `json:"policyVersion"`
	DistanceMetres int64  `json:"distanceMetres"`
	FeeYER         string `json:"feeYer"`
}

// The donor's cumulative marginal per-km tariff is preserved, with a single
// whole-YER ceiling after adding all segments. No default rates are admitted.
// Geographic distance is rounded to the nearest metre only AFTER the original
// unrounded radius check; rounding can never authorize an out-of-range trip.
func estimateDistanceFee(delivery DeliveryServiceability, raw []byte) *DistanceFeeEstimate {
	e := delivery.Evidence
	if delivery.Status != "SERVICEABLE" || e == nil || e.StoreCityID == "" || e.StoreCityID != e.AddressCityID ||
		e.PolicyVersion < 1 || e.PolicyVersion > maxJSONSafeInteger || e.RadiusMetres <= 0 || e.RadiusMetres > math.MaxInt32 ||
		math.IsNaN(e.DistanceMetres) || math.IsInf(e.DistanceMetres, 0) || e.DistanceMetres < 0 || e.DistanceMetres > float64(e.RadiusMetres) {
		return nil
	}
	distance := int64(math.Round(e.DistanceMetres))
	fee, ok := storeavailability.DistanceBandFee(distance, raw)
	if !ok {
		return nil
	}
	return &DistanceFeeEstimate{PolicyVersion: e.PolicyVersion, DistanceMetres: distance, FeeYER: fee}
}

func readDistanceFeeEstimate(ctx context.Context, tx *sql.Tx, delivery DeliveryServiceability) (*DistanceFeeEstimate, error) {
	if delivery.Status != "SERVICEABLE" || delivery.Evidence == nil {
		return nil, nil
	}
	e := delivery.Evidence
	var raw []byte
	// Read from the SAME owner snapshot as serviceability. An absent schedule
	// remains unavailable; there is no global/default tariff and no WLT effect.
	err := tx.QueryRowContext(ctx, `SELECT distance_bands FROM service_city_delivery_policies
 WHERE city_id=$1 AND version=$2 AND radius_metres=$3`, e.StoreCityID, e.PolicyVersion, e.RadiusMetres).Scan(&raw)
	if err != nil {
		return nil, err
	}
	return estimateDistanceFee(delivery, raw), nil
}
