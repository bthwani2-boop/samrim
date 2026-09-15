package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

type DeliveryAddressRecord struct {
	ID            string
	ClientActorID string
	AddressText   string
	Latitude      float64
	Longitude     float64
	ServiceCityID string
	Version       int
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type DeliveryAddressResult struct {
	Address  DeliveryAddressRecord
	Replayed bool
}

type DeliveryAddressListResult struct {
	Addresses  []DeliveryAddressRecord
	NextCursor string
}

type StoreDeliveryOriginRecord struct {
	StoreID       string
	OriginVersion int
	Latitude      float64
	Longitude     float64
	UpdatedAt     time.Time
}

type StoreDeliveryOriginResult struct {
	Origin   StoreDeliveryOriginRecord
	Replayed bool
}

var (
	ErrDeliveryAddressNotFound      = errors.New("delivery address was not found")
	ErrDeliveryAddressIdempotency   = errors.New("delivery address idempotency key was already used with different facts")
	ErrDeliveryAddressVersion       = errors.New("delivery address version is stale")
	ErrDeliveryAddressInvalidLimit  = errors.New("delivery address limit is invalid")
	ErrDeliveryAddressInvalidCursor = errors.New("delivery address cursor is invalid")
	ErrStoreOriginNotFound          = errors.New("store was not found")
	ErrStoreOriginIdempotency       = errors.New("store delivery origin idempotency key was already used with different facts")
	ErrStoreOriginVersion           = errors.New("store delivery origin version is stale")
)

func HashDeliveryAddressCreateRequest(clientActorID, addressText string, latitude, longitude float64, serviceCityIDs ...string) string {
	facts := []string{"create", clientActorID, addressText, formatCoordinate(latitude), formatCoordinate(longitude)}
	if len(serviceCityIDs) > 0 {
		facts = append(facts, strings.TrimSpace(serviceCityIDs[0]))
	}
	return hashLocationFacts(facts...)
}

func HashDeliveryAddressUpdateRequest(addressID, clientActorID, addressText string, latitude, longitude float64, expectedVersion int, serviceCityIDs ...string) string {
	facts := []string{"update", addressID, clientActorID, addressText, formatCoordinate(latitude), formatCoordinate(longitude), strconv.Itoa(expectedVersion)}
	if len(serviceCityIDs) > 0 {
		facts = append(facts, strings.TrimSpace(serviceCityIDs[0]))
	}
	return hashLocationFacts(facts...)
}

func HashStoreDeliveryOriginRequest(storeID, partnerActorID string, latitude, longitude float64, expectedVersion int) string {
	return hashLocationFacts("store-delivery-origin", storeID, partnerActorID, formatCoordinate(latitude), formatCoordinate(longitude), strconv.Itoa(expectedVersion))
}

func hashLocationFacts(facts ...string) string {
	digest := sha256.Sum256([]byte(strings.Join(facts, "\x00")))
	return hex.EncodeToString(digest[:])
}

func ListDeliveryAddresses(ctx context.Context, db *sql.DB, clientActorID string, limit int, cursor string) (DeliveryAddressListResult, error) {
	if db == nil {
		return DeliveryAddressListResult{}, errors.New("DSH database is nil")
	}
	clientActorID = strings.TrimSpace(clientActorID)
	if clientActorID == "" {
		return DeliveryAddressListResult{}, ErrDeliveryAddressNotFound
	}
	if limit < 1 || limit > 50 {
		return DeliveryAddressListResult{}, ErrDeliveryAddressInvalidLimit
	}
	where := "client_actor_id=$1"
	args := []any{clientActorID}
	if strings.TrimSpace(cursor) != "" {
		position, err := decodeDeliveryAddressCursor(cursor)
		if err != nil {
			return DeliveryAddressListResult{}, err
		}
		args = append(args, position.CreatedAt, position.ID)
		where += fmt.Sprintf(" AND (created_at,id) < ($%d,$%d)", len(args)-1, len(args))
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`SELECT id, client_actor_id, address_text, latitude, longitude, service_city_id, version, created_at, updated_at
		FROM dsh.delivery_addresses WHERE %s ORDER BY created_at DESC, id DESC LIMIT $%d`, where, len(args)), args...)
	if err != nil {
		return DeliveryAddressListResult{}, fmt.Errorf("list delivery addresses: %w", err)
	}
	defer func() { _ = rows.Close() }()
	addresses := make([]DeliveryAddressRecord, 0, limit+1)
	for rows.Next() {
		address, scanErr := scanDeliveryAddress(rows)
		if scanErr != nil {
			return DeliveryAddressListResult{}, fmt.Errorf("scan delivery address: %w", scanErr)
		}
		addresses = append(addresses, address)
	}
	if err := rows.Err(); err != nil {
		return DeliveryAddressListResult{}, fmt.Errorf("read delivery addresses: %w", err)
	}
	result := DeliveryAddressListResult{Addresses: addresses}
	if len(addresses) > limit {
		last := addresses[limit-1]
		result.Addresses = addresses[:limit]
		result.NextCursor = encodeDeliveryAddressCursor(last)
	}
	return result, nil
}

type deliveryAddressCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func encodeDeliveryAddressCursor(address DeliveryAddressRecord) string {
	payload, _ := json.Marshal(deliveryAddressCursor{CreatedAt: address.CreatedAt, ID: address.ID})
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeDeliveryAddressCursor(raw string) (deliveryAddressCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return deliveryAddressCursor{}, ErrDeliveryAddressInvalidCursor
	}
	var cursor deliveryAddressCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.ID == "" || cursor.CreatedAt.IsZero() {
		return deliveryAddressCursor{}, ErrDeliveryAddressInvalidCursor
	}
	return cursor, nil
}

func ReadDeliveryAddress(ctx context.Context, db *sql.DB, addressID, clientActorID string) (DeliveryAddressRecord, error) {
	if db == nil {
		return DeliveryAddressRecord{}, errors.New("DSH database is nil")
	}
	addressID = strings.TrimSpace(addressID)
	clientActorID = strings.TrimSpace(clientActorID)
	if addressID == "" || clientActorID == "" {
		return DeliveryAddressRecord{}, ErrDeliveryAddressNotFound
	}
	address, err := scanDeliveryAddress(db.QueryRowContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, service_city_id, version, created_at, updated_at
		FROM dsh.delivery_addresses WHERE id=$1 AND client_actor_id=$2`, addressID, clientActorID))
	if errors.Is(err, sql.ErrNoRows) {
		return DeliveryAddressRecord{}, ErrDeliveryAddressNotFound
	}
	if err != nil {
		return DeliveryAddressRecord{}, fmt.Errorf("read delivery address: %w", err)
	}
	return address, nil
}

func CreateDeliveryAddress(ctx context.Context, db *sql.DB, clientActorID, addressText string, latitude, longitude float64, idempotencyKey, requestHash, correlationID string, serviceCityIDs ...string) (DeliveryAddressResult, error) {
	clientActorID = strings.TrimSpace(clientActorID)
	addressText = strings.TrimSpace(addressText)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
	serviceCityID := ""
	if len(serviceCityIDs) > 0 {
		serviceCityID = strings.TrimSpace(serviceCityIDs[0])
	}
	latitude, longitude, err := normalizeLocation(latitude, longitude)
	if db == nil || clientActorID == "" || !validAddressText(addressText) || err != nil || idempotencyKey == "" || requestHash == "" || correlationID == "" {
		return DeliveryAddressResult{}, errors.New("delivery address facts are invalid")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("begin delivery address create: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:delivery-address:idempotency:"+idempotencyKey); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("lock delivery address idempotency: %w", err)
	}
	var storedHash, storedAddressID, storedActor, storedOperation string
	var storedExpected sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT request_hash, address_id, client_actor_id, operation, expected_version
		FROM dsh.delivery_address_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedAddressID, &storedActor, &storedOperation, &storedExpected)

	if err == nil {
		if storedHash != requestHash || storedActor != clientActorID || storedOperation != "create" || storedExpected.Valid {
			return DeliveryAddressResult{}, ErrDeliveryAddressIdempotency
		}
		address, readErr := scanDeliveryAddress(tx.QueryRowContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, service_city_id, version, created_at, updated_at
			FROM dsh.delivery_addresses WHERE id=$1 AND client_actor_id=$2`, storedAddressID, clientActorID))
		if errors.Is(readErr, sql.ErrNoRows) {
			return DeliveryAddressResult{}, ErrDeliveryAddressNotFound
		}
		if readErr != nil {
			return DeliveryAddressResult{}, fmt.Errorf("read idempotent delivery address: %w", readErr)
		}
		if err := tx.Commit(); err != nil {
			return DeliveryAddressResult{}, fmt.Errorf("commit idempotent delivery address: %w", err)
		}
		return DeliveryAddressResult{Address: address, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeliveryAddressResult{}, fmt.Errorf("read delivery address idempotency: %w", err)
	}

	addressID, err := newID("addr")
	if err != nil {
		return DeliveryAddressResult{}, err
	}
	address, err := scanDeliveryAddress(tx.QueryRowContext(ctx, `INSERT INTO dsh.delivery_addresses(id, client_actor_id, address_text, latitude, longitude, service_city_id)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''))
		RETURNING id, client_actor_id, address_text, latitude, longitude, service_city_id, version, created_at, updated_at`, addressID, clientActorID, addressText, latitude, longitude, serviceCityID))
	if err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("create canonical delivery address: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.delivery_address_mutation_idempotency
		(idempotency_key, request_hash, address_id, client_actor_id, operation)
		VALUES($1,$2,$3,$4,'create')`, idempotencyKey, requestHash, address.ID, clientActorID); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("record delivery address idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.delivery_address_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, client_actor_id, address_id, result_version, request_hash)
		VALUES('delivery_address_created',$1,$2,$3,$4,$5,$6,$7)`, idempotencyKey, correlationID, clientActorID, clientActorID, address.ID, address.Version, requestHash); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("record delivery address audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("commit delivery address: %w", err)
	}
	return DeliveryAddressResult{Address: address}, nil
}

func UpdateDeliveryAddress(ctx context.Context, db *sql.DB, addressID, clientActorID, addressText string, latitude, longitude float64, expectedVersion int, idempotencyKey, requestHash, correlationID string, serviceCityIDs ...string) (DeliveryAddressResult, error) {
	addressID = strings.TrimSpace(addressID)
	clientActorID = strings.TrimSpace(clientActorID)
	addressText = strings.TrimSpace(addressText)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
	serviceCityID := ""
	if len(serviceCityIDs) > 0 {
		serviceCityID = strings.TrimSpace(serviceCityIDs[0])
	}
	latitude, longitude, err := normalizeLocation(latitude, longitude)
	if db == nil || addressID == "" || clientActorID == "" || !validAddressText(addressText) || err != nil || expectedVersion < 1 || idempotencyKey == "" || requestHash == "" || correlationID == "" {
		return DeliveryAddressResult{}, errors.New("delivery address facts are invalid")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("begin delivery address update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:delivery-address:idempotency:"+idempotencyKey); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("lock delivery address idempotency: %w", err)
	}
	var storedHash, storedAddressID, storedActor, storedOperation string
	var storedExpected sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT request_hash, address_id, client_actor_id, operation, expected_version
		FROM dsh.delivery_address_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedAddressID, &storedActor, &storedOperation, &storedExpected)
	if err == nil {
		if storedHash != requestHash || storedActor != clientActorID || storedAddressID != addressID || storedOperation != "update" || !storedExpected.Valid || int(storedExpected.Int64) != expectedVersion {
			return DeliveryAddressResult{}, ErrDeliveryAddressIdempotency
		}
		address, readErr := scanDeliveryAddress(tx.QueryRowContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, service_city_id, version, created_at, updated_at
			FROM dsh.delivery_addresses WHERE id=$1 AND client_actor_id=$2`, addressID, clientActorID))
		if errors.Is(readErr, sql.ErrNoRows) {
			return DeliveryAddressResult{}, ErrDeliveryAddressNotFound
		}
		if readErr != nil {
			return DeliveryAddressResult{}, fmt.Errorf("read idempotent delivery address update: %w", readErr)
		}
		if err := tx.Commit(); err != nil {
			return DeliveryAddressResult{}, fmt.Errorf("commit idempotent delivery address update: %w", err)
		}
		return DeliveryAddressResult{Address: address, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeliveryAddressResult{}, fmt.Errorf("read delivery address update idempotency: %w", err)
	}

	current, err := scanDeliveryAddress(tx.QueryRowContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, service_city_id, version, created_at, updated_at
		FROM dsh.delivery_addresses WHERE id=$1 FOR UPDATE`, addressID))
	if errors.Is(err, sql.ErrNoRows) || current.ClientActorID != clientActorID {
		return DeliveryAddressResult{}, ErrDeliveryAddressNotFound
	}
	if err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("read delivery address for update: %w", err)
	}
	if current.Version != expectedVersion {
		return DeliveryAddressResult{}, ErrDeliveryAddressVersion
	}
	updated, err := scanDeliveryAddress(tx.QueryRowContext(ctx, `UPDATE dsh.delivery_addresses
		SET address_text=$2, latitude=$3, longitude=$4, service_city_id=COALESCE(NULLIF($5,''),service_city_id), version=version+1, updated_at=clock_timestamp()
		WHERE id=$1 AND client_actor_id=$6 AND version=$7
		RETURNING id, client_actor_id, address_text, latitude, longitude, service_city_id, version, created_at, updated_at`, addressID, addressText, latitude, longitude, serviceCityID, clientActorID, expectedVersion))
	if err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("update canonical delivery address: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.delivery_address_mutation_idempotency
		(idempotency_key, request_hash, address_id, client_actor_id, operation, expected_version)
		VALUES($1,$2,$3,$4,'update',$5)`, idempotencyKey, requestHash, addressID, clientActorID, expectedVersion); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("record delivery address update idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.delivery_address_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, client_actor_id, address_id, expected_version, result_version, request_hash)
		VALUES('delivery_address_updated',$1,$2,$3,$4,$5,$6,$7,$8)`, idempotencyKey, correlationID, clientActorID, clientActorID, addressID, expectedVersion, updated.Version, requestHash); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("record delivery address update audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("commit delivery address update: %w", err)
	}
	return DeliveryAddressResult{Address: updated}, nil
}

func ReadStoreDeliveryOrigin(ctx context.Context, db *sql.DB, storeID, partnerActorID string) (StoreDeliveryOriginRecord, bool, error) {
	if db == nil {
		return StoreDeliveryOriginRecord{}, false, errors.New("DSH database is nil")
	}
	storeID = strings.TrimSpace(storeID)
	partnerActorID = strings.TrimSpace(partnerActorID)
	if storeID == "" || partnerActorID == "" {
		return StoreDeliveryOriginRecord{}, false, ErrStoreOriginNotFound
	}
	origin, available, err := scanStoreDeliveryOrigin(db.QueryRowContext(ctx, `SELECT id, delivery_origin_version, delivery_origin_latitude, delivery_origin_longitude, delivery_origin_updated_at
		FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2`, storeID, partnerActorID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreDeliveryOriginRecord{}, false, ErrStoreOriginNotFound
	}
	if err != nil {
		return StoreDeliveryOriginRecord{}, false, fmt.Errorf("read Store delivery origin: %w", err)
	}
	return origin, available, nil
}

func SetStoreDeliveryOrigin(ctx context.Context, db *sql.DB, storeID, partnerActorID string, latitude, longitude float64, expectedVersion int, idempotencyKey, requestHash, correlationID string) (StoreDeliveryOriginResult, error) {
	storeID = strings.TrimSpace(storeID)
	partnerActorID = strings.TrimSpace(partnerActorID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
	latitude, longitude, err := normalizeLocation(latitude, longitude)
	if db == nil || storeID == "" || partnerActorID == "" || err != nil || expectedVersion < 0 || idempotencyKey == "" || requestHash == "" || correlationID == "" {
		return StoreDeliveryOriginResult{}, errors.New("store delivery origin facts are invalid")
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("begin store delivery origin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:store-origin:idempotency:"+idempotencyKey); err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("lock store delivery origin idempotency: %w", err)
	}
	var storedHash, storedStoreID, storedPartner string
	var storedExpected int
	err = tx.QueryRowContext(ctx, `SELECT request_hash, store_id, partner_actor_id, expected_version
		FROM dsh.store_origin_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedStoreID, &storedPartner, &storedExpected)
	if err == nil {
		if storedHash != requestHash || storedStoreID != storeID || storedPartner != partnerActorID || storedExpected != expectedVersion {
			return StoreDeliveryOriginResult{}, ErrStoreOriginIdempotency
		}
		origin, available, readErr := scanStoreDeliveryOrigin(tx.QueryRowContext(ctx, `SELECT id, delivery_origin_version, delivery_origin_latitude, delivery_origin_longitude, delivery_origin_updated_at
			FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2`, storeID, partnerActorID))
		if errors.Is(readErr, sql.ErrNoRows) {
			return StoreDeliveryOriginResult{}, ErrStoreOriginNotFound
		}
		if readErr != nil {
			return StoreDeliveryOriginResult{}, fmt.Errorf("read idempotent Store delivery origin: %w", readErr)
		}
		if !available {
			return StoreDeliveryOriginResult{}, fmt.Errorf("read idempotent Store delivery origin: %w", ErrStoreOriginNotFound)
		}
		if err := tx.Commit(); err != nil {
			return StoreDeliveryOriginResult{}, fmt.Errorf("commit idempotent store delivery origin: %w", err)
		}
		return StoreDeliveryOriginResult{Origin: origin, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreDeliveryOriginResult{}, fmt.Errorf("read store delivery origin idempotency: %w", err)
	}

	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT delivery_origin_version FROM dsh.stores
		WHERE id=$1 AND partner_actor_id=$2 FOR UPDATE`, storeID, partnerActorID).Scan(&currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreDeliveryOriginResult{}, ErrStoreOriginNotFound
	}
	if err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("read store for delivery origin: %w", err)
	}
	if currentVersion != expectedVersion {
		return StoreDeliveryOriginResult{}, ErrStoreOriginVersion
	}
	var result StoreDeliveryOriginRecord
	err = tx.QueryRowContext(ctx, `UPDATE dsh.stores
		SET delivery_origin_latitude=$2, delivery_origin_longitude=$3, delivery_origin_version=delivery_origin_version+1, delivery_origin_updated_at=clock_timestamp()
		WHERE id=$1 AND partner_actor_id=$4 AND delivery_origin_version=$5
		RETURNING id, delivery_origin_version, delivery_origin_latitude, delivery_origin_longitude, delivery_origin_updated_at`, storeID, latitude, longitude, partnerActorID, expectedVersion).Scan(&result.StoreID, &result.OriginVersion, &result.Latitude, &result.Longitude, &result.UpdatedAt)
	if err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("update canonical Store delivery origin: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_origin_mutation_idempotency
		(idempotency_key, request_hash, store_id, partner_actor_id, expected_version)
		VALUES($1,$2,$3,$4,$5)`, idempotencyKey, requestHash, storeID, partnerActorID, expectedVersion); err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("record store delivery origin idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_origin_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, partner_actor_id, store_id, expected_version, result_version, request_hash)
		VALUES('store_delivery_origin_set',$1,$2,$3,$4,$5,$6,$7,$8)`, idempotencyKey, correlationID, partnerActorID, partnerActorID, storeID, expectedVersion, result.OriginVersion, requestHash); err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("record store delivery origin audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("commit Store delivery origin: %w", err)
	}
	return StoreDeliveryOriginResult{Origin: result}, nil
}

func scanStoreDeliveryOrigin(row rowScanner) (StoreDeliveryOriginRecord, bool, error) {
	var origin StoreDeliveryOriginRecord
	var latitude, longitude sql.NullFloat64
	var updatedAt sql.NullTime
	if err := row.Scan(&origin.StoreID, &origin.OriginVersion, &latitude, &longitude, &updatedAt); err != nil {
		return StoreDeliveryOriginRecord{}, false, err
	}
	if origin.OriginVersion == 0 {
		return origin, false, nil
	}
	if !latitude.Valid || !longitude.Valid || !updatedAt.Valid {
		return StoreDeliveryOriginRecord{}, false, errors.New("canonical Store delivery origin is incomplete")
	}
	origin.Latitude = latitude.Float64
	origin.Longitude = longitude.Float64
	origin.UpdatedAt = updatedAt.Time
	return origin, true, nil
}

type deliveryAddressScanner interface {
	Scan(dest ...any) error
}

func scanDeliveryAddress(row deliveryAddressScanner) (DeliveryAddressRecord, error) {
	var address DeliveryAddressRecord
	var serviceCityID sql.NullString
	if err := row.Scan(&address.ID, &address.ClientActorID, &address.AddressText, &address.Latitude, &address.Longitude, &serviceCityID, &address.Version, &address.CreatedAt, &address.UpdatedAt); err != nil {
		return DeliveryAddressRecord{}, err
	}
	if serviceCityID.Valid {
		address.ServiceCityID = serviceCityID.String
	}
	return address, nil
}

func normalizeLocation(latitude, longitude float64) (float64, float64, error) {
	if !validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180) {
		return 0, 0, errors.New("coordinates are invalid")
	}
	return normalizeCoordinate(latitude), normalizeCoordinate(longitude), nil
}

func validCoordinate(value, minimum, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minimum && value <= maximum
}

func normalizeCoordinate(value float64) float64 {
	return math.Round(value*1_000_000) / 1_000_000
}

func formatCoordinate(value float64) string {
	return strconv.FormatFloat(normalizeCoordinate(value), 'f', 6, 64)
}

func validAddressText(value string) bool {
	length := len([]rune(strings.TrimSpace(value)))
	return length >= 3 && length <= 500
}
