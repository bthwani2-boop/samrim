package customercart

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"math"
	"strconv"
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
	var bands []struct {
		UpToMeters     json.RawMessage `json:"upToMeters"`
		RatePerKmMinor int64           `json:"ratePerKmMinor"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&bands) != nil || decoder.Decode(new(any)) != io.EOF || len(bands) < 1 || len(bands) > 30 {
		return nil
	}
	distance := int64(math.Round(e.DistanceMetres))
	var previous, total int64
	for i, b := range bands {
		if b.RatePerKmMinor <= 0 || b.RatePerKmMinor > 100000000 || len(b.UpToMeters) == 0 {
			return nil
		}
		var end int64
		if i == len(bands)-1 {
			if !bytes.Equal(bytes.TrimSpace(b.UpToMeters), []byte("null")) {
				return nil
			}
			end = distance
		} else {
			if json.Unmarshal(b.UpToMeters, &end) != nil || end <= previous || end > 500000 {
				return nil
			}
		}
		if distance > previous {
			limit := min(end, distance)
			// Distance is bounded by the int32 owner radius, and every metre is
			// counted at most once at a rate <= 1e8; total cannot overflow int64.
			total += (limit - previous) * b.RatePerKmMinor
		}
		previous = end
	}
	return &DistanceFeeEstimate{PolicyVersion: e.PolicyVersion, DistanceMetres: distance, FeeYER: strconv.FormatInt((total+999)/1000, 10)}
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
