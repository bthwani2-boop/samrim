package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// Bounded projections read directly from active WLT policy rows; no shadow state.
type OperatorPolicyRegistry struct {
	DeliveryFees  []OperatorFeeBrief    `json:"deliveryFees"`
	FieldRewards  []OperatorRewardBrief `json:"fieldRewards"`
	DeliveryTotal int64                 `json:"deliveryTotal"`
	FieldTotal    int64                 `json:"fieldTotal"`
}
type OperatorFeeBrief struct {
	ServiceCityID string                 `json:"serviceCityId"`
	DistanceBands []DeliveryDistanceBand `json:"distanceBands"`
	PolicyVersion string                 `json:"policyVersion"`
	Version       int                    `json:"version"`
	CreatedAt     time.Time              `json:"createdAt"`
	CreatedBy     string                 `json:"createdBy"`
}
type OperatorRewardBrief struct {
	ScopeType   string    `json:"scopeType"`
	ScopeID     string    `json:"scopeId"`
	RewardMinor int64     `json:"rewardMinor"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"createdAt"`
	CreatedBy   string    `json:"createdBy"`
}

func ReadOperatorPolicyRegistry(ctx context.Context, db *sql.DB) (OperatorPolicyRegistry, error) {
	out := OperatorPolicyRegistry{DeliveryFees: []OperatorFeeBrief{}, FieldRewards: []OperatorRewardBrief{}}
	if db == nil {
		return out, ErrDeliveryFeePolicyInvalidInput
	}
	err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM wlt.delivery_fee_policies WHERE state='ACTIVE' AND distance_bands IS NOT NULL").Scan(&out.DeliveryTotal)
	if err != nil {
		return out, err
	}
	fees, err := db.QueryContext(ctx, `SELECT service_city_id,distance_bands,policy_version,version,created_at,created_by
  FROM wlt.delivery_fee_policies WHERE state='ACTIVE' AND distance_bands IS NOT NULL ORDER BY service_city_id LIMIT 100`)
	if err != nil {
		return out, err
	}
	for fees.Next() {
		var p OperatorFeeBrief
		var raw []byte
		if err = fees.Scan(&p.ServiceCityID, &raw, &p.PolicyVersion, &p.Version, &p.CreatedAt, &p.CreatedBy); err != nil {
			fees.Close()
			return out, err
		}
		if err = json.Unmarshal(raw, &p.DistanceBands); err != nil {
			fees.Close()
			return out, err
		}
		out.DeliveryFees = append(out.DeliveryFees, p)
	}
	err = fees.Err()
	fees.Close()
	if err != nil {
		return out, err
	}
	return out, nil
}
