package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

// UpToMeters=nil on the final tier: the last per-kilometre rate continues without a cap.
type DeliveryDistanceBand struct {
	UpToMeters     *int64 `json:"upToMeters"`
	RatePerKmMinor int64  `json:"ratePerKmMinor"`
}
type CreateDistanceBandFeePolicyInput struct {
	ServiceCityID                                        string
	Bands                                                []DeliveryDistanceBand
	ExpectedVersion                                      int
	Reason, ActingActorID, IdempotencyKey, CorrelationID string
}

func validDeliveryDistanceBands(bands []DeliveryDistanceBand) bool {
	if len(bands) < 1 || len(bands) > 30 {
		return false
	}
	var last int64
	for i, b := range bands {
		if b.RatePerKmMinor <= 0 || b.RatePerKmMinor > 100000000 {
			return false
		}
		if i == len(bands)-1 {
			if b.UpToMeters != nil {
				return false
			}
		} else {
			if b.UpToMeters == nil || *b.UpToMeters <= last || *b.UpToMeters > 500000 {
				return false
			}
			last = *b.UpToMeters
		}
	}
	return true
}
func calculateDistanceBandFee(distanceMeters int64, bands []DeliveryDistanceBand) (int64, error) {
	if distanceMeters < 0 || !validDeliveryDistanceBands(bands) {
		return 0, ErrDeliveryFeeQuoteInvalidInput
	}
	total := new(big.Int)
	var previous int64
	for _, b := range bands {
		if distanceMeters <= previous {
			break
		}
		end := distanceMeters
		if b.UpToMeters != nil && *b.UpToMeters < end {
			end = *b.UpToMeters
		}
		if end > previous {
			piece := new(big.Int).Mul(big.NewInt(end-previous), big.NewInt(b.RatePerKmMinor))
			total.Add(total, piece)
		}
		previous = end
	}
	// Exact cumulative distance pricing, rounded up to one whole YER only.
	total.Add(total, big.NewInt(999))
	total.Quo(total, big.NewInt(1000))
	if !total.IsInt64() {
		return 0, ErrDeliveryFeeQuoteInvalidInput
	}
	return total.Int64(), nil
}
func CreateDistanceBandFeePolicy(ctx context.Context, db *sql.DB, input CreateDistanceBandFeePolicyInput) (DeliveryFeePolicyRecord, bool, error) {
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.Reason = strings.Join(strings.Fields(input.Reason), " ")
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || len(input.ServiceCityID) > 128 || !validDeliveryDistanceBands(input.Bands) ||
		input.ExpectedVersion < 0 || len(input.Reason) < 5 || len(input.Reason) > 500 ||
		len(input.ActingActorID) < 1 || len(input.ActingActorID) > 128 ||
		len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 ||
		len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return DeliveryFeePolicyRecord{}, false, ErrDeliveryFeePolicyInvalidInput
	}
	data, err := json.Marshal(input.Bands)
	if err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	hashInput := fmt.Sprintf("distance-bands-v1\x00%s\x00%s\x00%d\x00%s\x00%s", input.ServiceCityID, string(data), input.ExpectedVersion, input.Reason, input.ActingActorID)
	digest := sha256.Sum256([]byte(hashInput))
	hash := hex.EncodeToString(digest[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:delivery-fee-policy:"+input.ServiceCityID); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT policy_id,request_hash FROM wlt.delivery_fee_policy_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != hash {
			return DeliveryFeePolicyRecord{}, false, ErrIdempotencyConflict
		}
		policy, readErr := readDeliveryFeePolicyByID(ctx, tx, existingID)
		if readErr != nil {
			return DeliveryFeePolicyRecord{}, false, readErr
		}
		if err = tx.Commit(); err != nil {
			return DeliveryFeePolicyRecord{}, false, err
		}
		return policy, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeliveryFeePolicyRecord{}, false, err
	}
	var currentVersion int
	err = tx.QueryRowContext(ctx, "SELECT version FROM wlt.delivery_fee_policies WHERE service_city_id=$1 AND state='ACTIVE' FOR UPDATE", input.ServiceCityID).Scan(&currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return DeliveryFeePolicyRecord{}, false, err
	}
	if input.ExpectedVersion != currentVersion {
		return DeliveryFeePolicyRecord{}, false, ErrVersionConflict
	}
	id, err := newID("delivery-policy")
	if err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	version := currentVersion + 1
	if _, err = tx.ExecContext(ctx, "UPDATE wlt.delivery_fee_policies SET state='RETIRED',retired_at=clock_timestamp() WHERE service_city_id=$1 AND state='ACTIVE'", input.ServiceCityID); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	scope := input.ServiceCityID
	if scope == "" {
		scope = "global"
	}
	code := fmt.Sprintf("delivery-fee:%s:v%d", scope, version)
	// Legacy numeric columns are retained only for schema compatibility and never read for new quotes.
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.delivery_fee_policies
  (id,service_city_id,policy_version,state,base_fee_minor,distance_unit_meters,distance_rate_minor,order_size_unit_base_units,order_size_rate_minor,zone_surcharge_minor,rounding_unit_minor,version,created_by,distance_bands)
  VALUES($1,$2,$3,'ACTIVE',0,1000,0,1,0,0,50,$4,$5,$6::jsonb)`, id, input.ServiceCityID, code, version, input.ActingActorID, string(data)); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO wlt.delivery_fee_policy_events
 (policy_id,event_type,service_city_id,policy_version,request_hash,idempotency_key,correlation_id,acting_actor_id,expected_version,change_reason)
 VALUES($1,'DELIVERY_FEE_POLICY_ACTIVATED',$2,$3,$4,$5,$6,$7,$8,$9)`, id, input.ServiceCityID, code, hash, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, input.ExpectedVersion, input.Reason); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	result, err := ReadDeliveryFeePolicy(ctx, db, input.ServiceCityID)
	return result, false, err
}
