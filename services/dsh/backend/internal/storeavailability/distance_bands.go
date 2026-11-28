package storeavailability

import (
	"bytes"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"math"
	"strconv"
)

// DistanceBand represents the DSH cumulative per-kilometre tariff in whole YER.
type DistanceBand struct {
	UpToMeters     *int64 `json:"upToMeters"`
	RatePerKmMinor int64  `json:"ratePerKmMinor"`
}

// DecodeDistanceBands is the shared validation boundary for stored tariffs,
// checkout and operator previews. An explicit null denotes the final open tier.
func DecodeDistanceBands(raw []byte) ([]DistanceBand, bool) {
	var rows []struct {
		UpToMeters     jsontext.Value `json:"upToMeters"`
		RatePerKmMinor int64          `json:"ratePerKmMinor"`
	}
	if json.Unmarshal(raw, &rows, json.RejectUnknownMembers(true)) != nil || len(rows) < 1 || len(rows) > 30 {
		return nil, false
	}
	bands := make([]DistanceBand, 0, len(rows))
	var previous int64
	for i, row := range rows {
		if row.RatePerKmMinor <= 0 || row.RatePerKmMinor > 100000000 || len(row.UpToMeters) == 0 {
			return nil, false
		}
		var bound *int64
		if i == len(rows)-1 {
			if !bytes.Equal(bytes.TrimSpace(row.UpToMeters), []byte("null")) {
				return nil, false
			}
		} else {
			var end int64
			if json.Unmarshal(row.UpToMeters, &end) != nil || end <= previous || end > 500000 {
				return nil, false
			}
			previous = end
			bound = &end
		}
		bands = append(bands, DistanceBand{UpToMeters: bound, RatePerKmMinor: row.RatePerKmMinor})
	}
	return bands, true
}

// DistanceBandFee returns an advisory whole-YER fee, never a WLT allocation.
// A bounded distance and rate make overflow impossible; round only once.
func DistanceBandFee(distance int64, raw []byte) (string, bool) {
	if distance < 0 || distance > math.MaxInt32 {
		return "", false
	}
	bands, ok := DecodeDistanceBands(raw)
	if !ok {
		return "", false
	}
	var previous, total int64
	for _, band := range bands {
		if distance <= previous {
			break
		}
		end := distance
		if band.UpToMeters != nil {
			end = min(end, *band.UpToMeters)
		}
		total += (end - previous) * band.RatePerKmMinor
		previous = end
	}
	return strconv.FormatInt((total+999)/1000, 10), true
}
