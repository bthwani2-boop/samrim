package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// The initial operating radius is conservative until city-specific geographic
// boundaries are configured; DSH serviceability enforces the same 30km limit.
const maximumDeliveryDistanceMeters int64 = 30_000

var (
	ErrDeliveryFeePolicyInvalidInput = errors.New("delivery fee policy input is invalid")
	ErrDeliveryFeePolicyNotFound     = errors.New("delivery fee policy was not found")
	ErrDeliveryFeeQuoteInvalidInput  = errors.New("delivery fee quote input is invalid")
	ErrDeliveryOutsideCoverage       = errors.New("delivery distance exceeds supported service radius")
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
	DistanceBands          []DeliveryDistanceBand
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
	ExpectedVersion        int
	Reason                 string
	ActingActorID          string
	IdempotencyKey         string
	CorrelationID          string
}

type DeliveryFeeQuoteInput struct {
	StoreID              string
	FulfillmentMode      string
	ServiceCityID        string
	OriginLatitude       float64
	OriginLongitude      float64
	DestinationLatitude  float64
	DestinationLongitude float64
	OrderSizeBaseUnits   int64
}

type DeliveryFeeQuoteRecord struct {
	CaptainEarningMinor int64
	PlatformMarginMinor int64
	FeeMinor            int64
	PolicyVersion       string
	ServiceCityID       string
	DistanceMeters      int64
	DistanceUnits       int64
	OrderSizeBaseUnits  int64
	OrderSizeUnits      int64
	RoundingUnitMinor   int64
}

func HashDeliveryFeePolicyRequest(input CreateDeliveryFeePolicyInput) string {
	return hashDeliveryFeePolicyRequest(input, true)
}

// Keep the historic fingerprint only to verify persisted pre-fix replays.
// New requests also bind the operator whose identity is frozen on the policy.
func hashDeliveryFeePolicyRequest(input CreateDeliveryFeePolicyInput, includeActor bool) string {
	parts := []string{"delivery-fee-policy", strings.TrimSpace(input.ServiceCityID), fmt.Sprintf("%d", input.BaseFeeMinor), fmt.Sprintf("%d", input.DistanceUnitMeters), fmt.Sprintf("%d", input.DistanceRateMinor), fmt.Sprintf("%d", input.OrderSizeUnitBaseUnits), fmt.Sprintf("%d", input.OrderSizeRateMinor), fmt.Sprintf("%d", input.ZoneSurchargeMinor), fmt.Sprintf("%d", input.RoundingUnitMinor), fmt.Sprintf("%d", input.ExpectedVersion), strings.TrimSpace(input.Reason)}
	if includeActor {
		parts = append(parts, "acting-actor:v1", strings.TrimSpace(input.ActingActorID))
	}
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(digest[:])
}

func CreateDeliveryFeePolicy(ctx context.Context, db *sql.DB, input CreateDeliveryFeePolicyInput) (DeliveryFeePolicyRecord, bool, error) {
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.ActingActorID = strings.TrimSpace(input.ActingActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.Reason = strings.Join(strings.Fields(strings.TrimSpace(input.Reason)), " ")
	if db == nil || len(input.ServiceCityID) > 128 || input.BaseFeeMinor < 0 || input.DistanceUnitMeters <= 0 || input.DistanceRateMinor < 0 || input.OrderSizeUnitBaseUnits <= 0 || input.OrderSizeRateMinor < 0 || input.ZoneSurchargeMinor < 0 || input.RoundingUnitMinor != 50 || input.ExpectedVersion < 0 || len(input.Reason) < 5 || len(input.Reason) > 500 || input.ActingActorID == "" || len(input.ActingActorID) > 128 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
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
		if storedHash != requestHash && storedHash != hashDeliveryFeePolicyRequest(input, false) {
			return DeliveryFeePolicyRecord{}, false, ErrIdempotencyConflict
		}
		policy, readErr := readDeliveryFeePolicyByID(ctx, tx, existingID)
		if readErr != nil {
			return DeliveryFeePolicyRecord{}, false, readErr
		}
		if policy.CreatedBy != input.ActingActorID {
			return DeliveryFeePolicyRecord{}, false, ErrIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
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
	version := currentVersion + 1
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.delivery_fee_policy_events(policy_id,event_type,service_city_id,policy_version,request_hash,idempotency_key,correlation_id,acting_actor_id,expected_version,change_reason) VALUES($1,'DELIVERY_FEE_POLICY_ACTIVATED',$2,$3,$4,$5,$6,$7,$8,$9)`, policyID, input.ServiceCityID, policyVersion, requestHash, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, input.ExpectedVersion, input.Reason); err != nil {
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
	return readExactActiveDeliveryFeePolicy(ctx, db, strings.TrimSpace(serviceCityID))
}

func readExactActiveDeliveryFeePolicy(ctx context.Context, db *sql.DB, serviceCityID string) (DeliveryFeePolicyRecord, error) {
	return readDeliveryFeePolicyRow(db.QueryRowContext(ctx, `SELECT id,service_city_id,policy_version,state,base_fee_minor,distance_unit_meters,distance_rate_minor,order_size_unit_base_units,order_size_rate_minor,zone_surcharge_minor,rounding_unit_minor,version,created_by,created_at,retired_at,distance_bands FROM wlt.delivery_fee_policies WHERE state='ACTIVE' AND service_city_id=$1`, serviceCityID))
}

func ResolveDeliveryFeeQuote(ctx context.Context, db *sql.DB, input DeliveryFeeQuoteInput) (DeliveryFeeQuoteRecord, error) {
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.FulfillmentMode = strings.TrimSpace(input.FulfillmentMode)
	if db == nil || len(input.ServiceCityID) > 128 || len(input.StoreID) > 128 || (input.StoreID != "" && input.FulfillmentMode != "BTHWANI_CAPTAIN" && input.FulfillmentMode != "PARTNER_CAPTAIN") || !validCoordinate(input.OriginLatitude, input.OriginLongitude) || !validCoordinate(input.DestinationLatitude, input.DestinationLongitude) {
		return DeliveryFeeQuoteRecord{}, ErrDeliveryFeeQuoteInvalidInput
	}
	policy, err := readActiveDeliveryFeePolicy(ctx, db, input.ServiceCityID)
	if err != nil {
		return DeliveryFeeQuoteRecord{}, err
	}
	distanceMeters := haversineMeters(input.OriginLatitude, input.OriginLongitude, input.DestinationLatitude, input.DestinationLongitude)
	// A shared city identifier is insufficient proof that an address is
	// deliverable. Never quote a 140km order as an ordinary local trip.
	if !deliveryDistanceWithinCoverage(distanceMeters) {
		return DeliveryFeeQuoteRecord{}, ErrDeliveryOutsideCoverage
	}
	if !validDeliveryDistanceBands(policy.DistanceBands) {
		return DeliveryFeeQuoteRecord{}, ErrDeliveryFeePolicyNotFound
	}
	amountMinor, err := calculateDistanceBandFee(distanceMeters, policy.DistanceBands)
	if err != nil {
		return DeliveryFeeQuoteRecord{}, err
	}
	marginMinor := int64(0)
	policyVersion := policy.PolicyVersion
	if input.StoreID != "" {
		var agreementID string
		var agreementVersion int
		err := db.QueryRowContext(ctx, `SELECT a.agreement_id,a.agreement_version,r.delivery_markup_minor
			FROM wlt.store_commercial_agreements a JOIN wlt.store_commercial_agreement_rates r
			ON r.agreement_id=a.agreement_id AND r.fulfillment_mode=$2
			WHERE a.store_id=$1 AND a.status='ACTIVE'`, input.StoreID, input.FulfillmentMode).
			Scan(&agreementID, &agreementVersion, &marginMinor)
		if errors.Is(err, sql.ErrNoRows) {
			return DeliveryFeeQuoteRecord{}, ErrStoreCommercialAgreementUnavailable
		}
		if err != nil {
			return DeliveryFeeQuoteRecord{}, err
		}
		if marginMinor < 0 || marginMinor > 10000 || marginMinor > math.MaxInt64-amountMinor {
			return DeliveryFeeQuoteRecord{}, ErrDeliveryFeeQuoteInvalidInput
		}
		policyVersion = fmt.Sprintf("%s;agreement=%s:v%d", policyVersion, agreementID, agreementVersion)
	}
	// The Store, not a BThwani Captain Wallet, owns Partner Captain delivery.
	captainEarningMinor := amountMinor
	if input.FulfillmentMode == "PARTNER_CAPTAIN" {
		captainEarningMinor = 0
	}
	distanceUnits := int64(0)
	return DeliveryFeeQuoteRecord{FeeMinor: amountMinor + marginMinor, CaptainEarningMinor: captainEarningMinor, PlatformMarginMinor: marginMinor, PolicyVersion: policyVersion, ServiceCityID: input.ServiceCityID, DistanceMeters: distanceMeters, DistanceUnits: distanceUnits, OrderSizeBaseUnits: input.OrderSizeBaseUnits, OrderSizeUnits: 0, RoundingUnitMinor: 1}, nil
}

func readActiveDeliveryFeePolicy(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, serviceCityID string) (DeliveryFeePolicyRecord, error) {
	return readDeliveryFeePolicyRow(source.QueryRowContext(ctx, `SELECT id,service_city_id,policy_version,state,base_fee_minor,distance_unit_meters,distance_rate_minor,order_size_unit_base_units,order_size_rate_minor,zone_surcharge_minor,rounding_unit_minor,version,created_by,created_at,retired_at,distance_bands FROM wlt.delivery_fee_policies WHERE state='ACTIVE' AND distance_bands IS NOT NULL AND service_city_id IN ($1,'') ORDER BY CASE WHEN service_city_id=$1 AND $1<>'' THEN 0 ELSE 1 END, version DESC LIMIT 1`, serviceCityID))
}

func readDeliveryFeePolicyByID(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, policyID string) (DeliveryFeePolicyRecord, error) {
	return readDeliveryFeePolicyRow(source.QueryRowContext(ctx, `SELECT id,service_city_id,policy_version,state,base_fee_minor,distance_unit_meters,distance_rate_minor,order_size_unit_base_units,order_size_rate_minor,zone_surcharge_minor,rounding_unit_minor,version,created_by,created_at,retired_at,distance_bands FROM wlt.delivery_fee_policies WHERE id=$1`, policyID))
}

func readDeliveryFeePolicyRow(row *sql.Row) (DeliveryFeePolicyRecord, error) {
	var result DeliveryFeePolicyRecord
	var retiredAt sql.NullTime
	var bands []byte
	err := row.Scan(&result.ID, &result.ServiceCityID, &result.PolicyVersion, &result.State, &result.BaseFeeMinor, &result.DistanceUnitMeters, &result.DistanceRateMinor, &result.OrderSizeUnitBaseUnits, &result.OrderSizeRateMinor, &result.ZoneSurchargeMinor, &result.RoundingUnitMinor, &result.Version, &result.CreatedBy, &result.CreatedAt, &retiredAt, &bands)
	if errors.Is(err, sql.ErrNoRows) {
		return DeliveryFeePolicyRecord{}, ErrDeliveryFeePolicyNotFound
	}
	if retiredAt.Valid {
		result.RetiredAt = &retiredAt.Time
	}
	if err == nil && len(bands) > 0 {
		if err := json.Unmarshal(bands, &result.DistanceBands); err != nil {
			return DeliveryFeePolicyRecord{}, err
		}
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

func deliveryDistanceWithinCoverage(distanceMeters int64) bool {
	return distanceMeters >= 0 && distanceMeters <= maximumDeliveryDistanceMeters
}
