package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"
)

var (
	ErrDeliveryFeePolicyInvalidInput = errors.New("delivery fee policy input is invalid")
	ErrDeliveryFeePolicyNotFound     = errors.New("delivery fee policy was not found")
	ErrDeliveryFeeQuoteInvalidInput  = errors.New("delivery fee quote input is invalid")
)

type DeliveryFeePolicyRecord struct {
	ID                     string
	ServiceCityID          string
	PolicyVersion          string
	State                  string
	BaseFeeMinor           int64
	DistanceUnitMeters     int64
	DistanceRateMinor      int64
	OrderSizeUnitBaseUnits int64
	OrderSizeRateMinor     int64
	ZoneSurchargeMinor     int64
	RoundingUnitMinor      int64
	Version                int
	CreatedBy              string
	CreatedAt              time.Time
	RetiredAt              *time.Time
}

type CreateDeliveryFeePolicyInput struct {
	ServiceCityID          string
	BaseFeeMinor           int64
	DistanceUnitMeters     int64
	DistanceRateMinor      int64
	OrderSizeUnitBaseUnits int64
	OrderSizeRateMinor     int64
	ZoneSurchargeMinor     int64
	RoundingUnitMinor      int64
	ActingActorID          string
	IdempotencyKey         string
	CorrelationID          string
}

type DeliveryFeeQuoteInput struct {
	ServiceCityID        string
	OriginLatitude       float64
	OriginLongitude      float64
	DestinationLatitude  float64
	DestinationLongitude float64
	OrderSizeBaseUnits   int64
}

type DeliveryFeeQuoteRecord struct {
	FeeMinor           int64
	PolicyVersion      string
	ServiceCityID      string
	DistanceMeters     int64
	DistanceUnits      int64
	OrderSizeBaseUnits int64
	OrderSizeUnits     int64
	RoundingUnitMinor  int64
}

func HashDeliveryFeePolicyRequest(input CreateDeliveryFeePolicyInput) string {
	parts := []string{"delivery-fee-policy", strings.TrimSpace(input.ServiceCityID), fmt.Sprintf("%d", input.BaseFeeMinor), fmt.Sprintf("%d", input.DistanceUnitMeters), fmt.Sprintf("%d", input.DistanceRateMinor), fmt.Sprintf("%d", input.OrderSizeUnitBaseUnits), fmt.Sprintf("%d", input.OrderSizeRateMinor), fmt.Sprintf("%d", input.ZoneSurchargeMinor), fmt.Sprintf("%d", input.RoundingUnitMinor)}
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(digest[:])
}

func CreateDeliveryFeePolicy(ctx context.Context, db *sql.DB, input CreateDeliveryFeePolicyInput) (DeliveryFeePolicyRecord, bool, error) {
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || len(input.ServiceCityID) > 128 || input.BaseFeeMinor < 0 || input.DistanceUnitMeters <= 0 || input.DistanceRateMinor < 0 || input.OrderSizeUnitBaseUnits <= 0 || input.OrderSizeRateMinor < 0 || input.ZoneSurchargeMinor < 0 || input.RoundingUnitMinor != 50 || input.ActingActorID == "" || len(input.ActingActorID) > 128 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return DeliveryFeePolicyRecord{}, false, ErrDeliveryFeePolicyInvalidInput
	}
	requestHash := HashDeliveryFeePolicyRequest(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:delivery-fee-policy:"+input.ServiceCityID); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	var existingID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT policy_id,request_hash FROM wlt.delivery_fee_policy_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &storedHash)
	if err == nil {
		if storedHash != requestHash {
			return DeliveryFeePolicyRecord{}, false, ErrIdempotencyConflict
		}
		policy, readErr := readDeliveryFeePolicyByID(ctx, tx, existingID)
		if readErr != nil {
			return DeliveryFeePolicyRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return DeliveryFeePolicyRecord{}, false, err
		}
		return policy, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeliveryFeePolicyRecord{}, false, err
	}
	var version int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM wlt.delivery_fee_policies WHERE service_city_id=$1", input.ServiceCityID).Scan(&version); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	policyID, err := newID("delivery-policy")
	if err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.delivery_fee_policies SET state='RETIRED',retired_at=clock_timestamp() WHERE service_city_id=$1 AND state='ACTIVE'", input.ServiceCityID); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	scope := input.ServiceCityID
	if scope == "" {
		scope = "global"
	}
	policyVersion := fmt.Sprintf("delivery-fee:%s:v%d", scope, version)
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.delivery_fee_policies(id,service_city_id,policy_version,state,base_fee_minor,distance_unit_meters,distance_rate_minor,order_size_unit_base_units,order_size_rate_minor,zone_surcharge_minor,rounding_unit_minor,version,created_by) VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8,$9,$10,$11,$12)`, policyID, input.ServiceCityID, policyVersion, input.BaseFeeMinor, input.DistanceUnitMeters, input.DistanceRateMinor, input.OrderSizeUnitBaseUnits, input.OrderSizeRateMinor, input.ZoneSurchargeMinor, input.RoundingUnitMinor, version, input.ActingActorID); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.delivery_fee_policy_events(policy_id,event_type,service_city_id,policy_version,request_hash,idempotency_key,correlation_id,acting_actor_id) VALUES($1,'DELIVERY_FEE_POLICY_ACTIVATED',$2,$3,$4,$5,$6,$7)`, policyID, input.ServiceCityID, policyVersion, requestHash, input.IdempotencyKey, input.CorrelationID, input.ActingActorID); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return DeliveryFeePolicyRecord{}, false, err
	}
	policy, err := ReadDeliveryFeePolicy(ctx, db, input.ServiceCityID)
	return policy, false, err
}

func ReadDeliveryFeePolicy(ctx context.Context, db *sql.DB, serviceCityID string) (DeliveryFeePolicyRecord, error) {
	if db == nil || len(strings.TrimSpace(serviceCityID)) > 128 {
		return DeliveryFeePolicyRecord{}, ErrDeliveryFeePolicyInvalidInput
	}
	return readActiveDeliveryFeePolicy(ctx, db, strings.TrimSpace(serviceCityID))
}

func ResolveDeliveryFeeQuote(ctx context.Context, db *sql.DB, input DeliveryFeeQuoteInput) (DeliveryFeeQuoteRecord, error) {
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	if db == nil || len(input.ServiceCityID) > 128 || input.OrderSizeBaseUnits <= 0 || !validCoordinate(input.OriginLatitude, input.OriginLongitude) || !validCoordinate(input.DestinationLatitude, input.DestinationLongitude) {
		return DeliveryFeeQuoteRecord{}, ErrDeliveryFeeQuoteInvalidInput
	}
	policy, err := readActiveDeliveryFeePolicy(ctx, db, input.ServiceCityID)
	if err != nil {
		return DeliveryFeeQuoteRecord{}, err
	}
	distanceMeters := haversineMeters(input.OriginLatitude, input.OriginLongitude, input.DestinationLatitude, input.DestinationLongitude)
	distanceUnits := ceilDivPositive(distanceMeters, policy.DistanceUnitMeters)
	orderSizeUnits := ceilDivPositive(input.OrderSizeBaseUnits, policy.OrderSizeUnitBaseUnits)
	amount := new(big.Int).SetInt64(policy.BaseFeeMinor)
	amount.Add(amount, new(big.Int).Mul(big.NewInt(policy.DistanceRateMinor), big.NewInt(distanceUnits)))
	amount.Add(amount, new(big.Int).Mul(big.NewInt(policy.OrderSizeRateMinor), big.NewInt(orderSizeUnits)))
	amount.Add(amount, big.NewInt(policy.ZoneSurchargeMinor))
	rounding := big.NewInt(policy.RoundingUnitMinor)
	amount.Add(amount, new(big.Int).Sub(rounding, big.NewInt(1)))
	amount.Quo(amount, rounding)
	amount.Mul(amount, rounding)
	if !amount.IsInt64() {
		return DeliveryFeeQuoteRecord{}, ErrDeliveryFeeQuoteInvalidInput
	}
	return DeliveryFeeQuoteRecord{FeeMinor: amount.Int64(), PolicyVersion: policy.PolicyVersion, ServiceCityID: input.ServiceCityID, DistanceMeters: distanceMeters, DistanceUnits: distanceUnits, OrderSizeBaseUnits: input.OrderSizeBaseUnits, OrderSizeUnits: orderSizeUnits, RoundingUnitMinor: policy.RoundingUnitMinor}, nil
}

func readActiveDeliveryFeePolicy(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, serviceCityID string) (DeliveryFeePolicyRecord, error) {
	return readDeliveryFeePolicyRow(source.QueryRowContext(ctx, `SELECT id,service_city_id,policy_version,state,base_fee_minor,distance_unit_meters,distance_rate_minor,order_size_unit_base_units,order_size_rate_minor,zone_surcharge_minor,rounding_unit_minor,version,created_by,created_at,retired_at FROM wlt.delivery_fee_policies WHERE state='ACTIVE' AND service_city_id IN ($1,'') ORDER BY CASE WHEN service_city_id=$1 AND $1<>'' THEN 0 ELSE 1 END, version DESC LIMIT 1`, serviceCityID))
}

func readDeliveryFeePolicyByID(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, policyID string) (DeliveryFeePolicyRecord, error) {
	return readDeliveryFeePolicyRow(source.QueryRowContext(ctx, `SELECT id,service_city_id,policy_version,state,base_fee_minor,distance_unit_meters,distance_rate_minor,order_size_unit_base_units,order_size_rate_minor,zone_surcharge_minor,rounding_unit_minor,version,created_by,created_at,retired_at FROM wlt.delivery_fee_policies WHERE id=$1`, policyID))
}

func readDeliveryFeePolicyRow(row *sql.Row) (DeliveryFeePolicyRecord, error) {
	var result DeliveryFeePolicyRecord
	var retiredAt sql.NullTime
	err := row.Scan(&result.ID, &result.ServiceCityID, &result.PolicyVersion, &result.State, &result.BaseFeeMinor, &result.DistanceUnitMeters, &result.DistanceRateMinor, &result.OrderSizeUnitBaseUnits, &result.OrderSizeRateMinor, &result.ZoneSurchargeMinor, &result.RoundingUnitMinor, &result.Version, &result.CreatedBy, &result.CreatedAt, &retiredAt)
	if errors.Is(err, sql.ErrNoRows) {
		return DeliveryFeePolicyRecord{}, ErrDeliveryFeePolicyNotFound
	}
	if retiredAt.Valid {
		result.RetiredAt = &retiredAt.Time
	}
	return result, err
}

func validCoordinate(latitude, longitude float64) bool {
	return !math.IsNaN(latitude) && !math.IsInf(latitude, 0) && !math.IsNaN(longitude) && !math.IsInf(longitude, 0) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

func ceilDivPositive(value, divisor int64) int64 {
	quotient, remainder := value/divisor, value%divisor
	if remainder != 0 {
		return quotient + 1
	}
	return quotient
}

func haversineMeters(latitudeA, longitudeA, latitudeB, longitudeB float64) int64 {
	const earthRadiusMeters = 6_371_000.0
	latitudeDelta := (latitudeB - latitudeA) * math.Pi / 180
	longitudeDelta := (longitudeB - longitudeA) * math.Pi / 180
	latitudeARadians := latitudeA * math.Pi / 180
	latitudeBRadians := latitudeB * math.Pi / 180
	a := math.Sin(latitudeDelta/2)*math.Sin(latitudeDelta/2) + math.Cos(latitudeARadians)*math.Cos(latitudeBRadians)*math.Sin(longitudeDelta/2)*math.Sin(longitudeDelta/2)
	if a < 0 {
		a = 0
	} else if a > 1 {
		a = 1
	}
	return int64(math.Round(earthRadiusMeters * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))))
}
