package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
	Version       int
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type DeliveryAddressResult struct {
	Address  DeliveryAddressRecord
	Replayed bool
}

type StoreDeliveryOriginRecord struct {
	StoreID      string
	StoreVersion int
	Latitude     float64
	Longitude    float64
	UpdatedAt    time.Time
}

type StoreDeliveryOriginResult struct {
	Origin   StoreDeliveryOriginRecord
	Replayed bool
}

var (
	ErrDeliveryAddressNotFound     = errors.New("delivery address was not found")
	ErrDeliveryAddressIdempotency  = errors.New("delivery address idempotency key was already used with different facts")
	ErrDeliveryAddressVersion      = errors.New("delivery address version is stale")
	ErrDeliveryAddressInvalidLimit = errors.New("delivery address limit is invalid")
	ErrStoreOriginNotFound         = errors.New("store was not found")
	ErrStoreOriginOwnership        = errors.New("store delivery origin ownership is invalid")
	ErrStoreOriginIdempotency      = errors.New("store delivery origin idempotency key was already used with different facts")
	ErrStoreOriginVersion          = errors.New("store delivery origin version is stale")
)

func HashDeliveryAddressCreateRequest(clientActorID, addressText string, latitude, longitude float64) string {
	return hashLocationFacts("create", clientActorID, addressText, formatCoordinate(latitude), formatCoordinate(longitude))
}

func HashDeliveryAddressUpdateRequest(addressID, clientActorID, addressText string, latitude, longitude float64, expectedVersion int) string {
	return hashLocationFacts("update", addressID, clientActorID, addressText, formatCoordinate(latitude), formatCoordinate(longitude), strconv.Itoa(expectedVersion))
}

func HashStoreDeliveryOriginRequest(storeID, partnerActorID string, latitude, longitude float64, expectedVersion int) string {
	return hashLocationFacts("store-delivery-origin", storeID, partnerActorID, formatCoordinate(latitude), formatCoordinate(longitude), strconv.Itoa(expectedVersion))
}

func hashLocationFacts(facts ...string) string {
	digest := sha256.Sum256([]byte(strings.Join(facts, "\x00")))
	return hex.EncodeToString(digest[:])
}

func ListDeliveryAddresses(ctx context.Context, db *sql.DB, clientActorID string, limit int) ([]DeliveryAddressRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	clientActorID = strings.TrimSpace(clientActorID)
	if clientActorID == "" {
		return nil, ErrDeliveryAddressNotFound
	}
	if limit < 1 || limit > 50 {
		return nil, ErrDeliveryAddressInvalidLimit
	}
	rows, err := db.QueryContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, version, created_at, updated_at
		FROM dsh.delivery_addresses WHERE client_actor_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`, clientActorID, limit)
	if err != nil {
		return nil, fmt.Errorf("list delivery addresses: %w", err)
	}
	defer func() { _ = rows.Close() }()
	addresses := make([]DeliveryAddressRecord, 0, limit)
	for rows.Next() {
		address, scanErr := scanDeliveryAddress(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan delivery address: %w", scanErr)
		}
		addresses = append(addresses, address)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read delivery addresses: %w", err)
	}
	return addresses, nil
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
	address, err := scanDeliveryAddress(db.QueryRowContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, version, created_at, updated_at
		FROM dsh.delivery_addresses WHERE id=$1 AND client_actor_id=$2`, addressID, clientActorID))
	if errors.Is(err, sql.ErrNoRows) {
		return DeliveryAddressRecord{}, ErrDeliveryAddressNotFound
	}
	if err != nil {
		return DeliveryAddressRecord{}, fmt.Errorf("read delivery address: %w", err)
	}
	return address, nil
}

func CreateDeliveryAddress(ctx context.Context, db *sql.DB, clientActorID, addressText string, latitude, longitude float64, idempotencyKey, requestHash, correlationID string) (DeliveryAddressResult, error) {
	clientActorID = strings.TrimSpace(clientActorID)
	addressText = strings.TrimSpace(addressText)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
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
	var storedVersion int
	err = tx.QueryRowContext(ctx, `SELECT request_hash, address_id, client_actor_id, operation, expected_version, result_version
		FROM dsh.delivery_address_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedAddressID, &storedActor, &storedOperation, &storedExpected, &storedVersion)
	if err == nil {
		if storedHash != requestHash || storedActor != clientActorID || storedOperation != "create" || storedExpected.Valid {
			return DeliveryAddressResult{}, ErrDeliveryAddressIdempotency
		}
		address, readErr := scanDeliveryAddress(tx.QueryRowContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, version, created_at, updated_at
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
		address.Version = storedVersion
		return DeliveryAddressResult{Address: address, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeliveryAddressResult{}, fmt.Errorf("read delivery address idempotency: %w", err)
	}

	addressID, err := newID("addr")
	if err != nil {
		return DeliveryAddressResult{}, err
	}
	address, err := scanDeliveryAddress(tx.QueryRowContext(ctx, `INSERT INTO dsh.delivery_addresses(id, client_actor_id, address_text, latitude, longitude)
		VALUES($1,$2,$3,$4,$5)
		RETURNING id, client_actor_id, address_text, latitude, longitude, version, created_at, updated_at`, addressID, clientActorID, addressText, latitude, longitude))
	if err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("create canonical delivery address: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.delivery_address_mutation_idempotency
		(idempotency_key, request_hash, address_id, client_actor_id, operation, result_version)
		VALUES($1,$2,$3,$4,'create',$5)`, idempotencyKey, requestHash, address.ID, clientActorID, address.Version); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("record delivery address idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.delivery_address_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, client_actor_id, address_id, result_version, request_hash, address_text, latitude, longitude)
		VALUES('delivery_address_created',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, idempotencyKey, correlationID, clientActorID, clientActorID, address.ID, address.Version, requestHash, address.AddressText, address.Latitude, address.Longitude); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("record delivery address audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("commit delivery address: %w", err)
	}
	return DeliveryAddressResult{Address: address}, nil
}

func UpdateDeliveryAddress(ctx context.Context, db *sql.DB, addressID, clientActorID, addressText string, latitude, longitude float64, expectedVersion int, idempotencyKey, requestHash, correlationID string) (DeliveryAddressResult, error) {
	addressID = strings.TrimSpace(addressID)
	clientActorID = strings.TrimSpace(clientActorID)
	addressText = strings.TrimSpace(addressText)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
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
	var storedVersion int
	err = tx.QueryRowContext(ctx, `SELECT request_hash, address_id, client_actor_id, operation, expected_version, result_version
		FROM dsh.delivery_address_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedAddressID, &storedActor, &storedOperation, &storedExpected, &storedVersion)
	if err == nil {
		if storedHash != requestHash || storedActor != clientActorID || storedAddressID != addressID || storedOperation != "update" || !storedExpected.Valid || int(storedExpected.Int64) != expectedVersion {
			return DeliveryAddressResult{}, ErrDeliveryAddressIdempotency
		}
		address, readErr := scanDeliveryAddress(tx.QueryRowContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, version, created_at, updated_at
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
		address.Version = storedVersion
		return DeliveryAddressResult{Address: address, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DeliveryAddressResult{}, fmt.Errorf("read delivery address update idempotency: %w", err)
	}

	current, err := scanDeliveryAddress(tx.QueryRowContext(ctx, `SELECT id, client_actor_id, address_text, latitude, longitude, version, created_at, updated_at
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
		SET address_text=$2, latitude=$3, longitude=$4, version=version+1, updated_at=clock_timestamp()
		WHERE id=$1 AND client_actor_id=$5 AND version=$6
		RETURNING id, client_actor_id, address_text, latitude, longitude, version, created_at, updated_at`, addressID, addressText, latitude, longitude, clientActorID, expectedVersion))
	if err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("update canonical delivery address: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.delivery_address_mutation_idempotency
		(idempotency_key, request_hash, address_id, client_actor_id, operation, expected_version, result_version)
		VALUES($1,$2,$3,$4,'update',$5,$6)`, idempotencyKey, requestHash, addressID, clientActorID, expectedVersion, updated.Version); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("record delivery address update idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.delivery_address_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, client_actor_id, address_id, expected_version, result_version, request_hash, address_text, latitude, longitude)
		VALUES('delivery_address_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, idempotencyKey, correlationID, clientActorID, clientActorID, addressID, expectedVersion, updated.Version, requestHash, updated.AddressText, updated.Latitude, updated.Longitude); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("record delivery address update audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return DeliveryAddressResult{}, fmt.Errorf("commit delivery address update: %w", err)
	}
	return DeliveryAddressResult{Address: updated}, nil
}

func ReadStoreDeliveryOrigin(ctx context.Context, db *sql.DB, storeID string) (StoreDeliveryOriginRecord, bool, error) {
	store, err := ReadStore(ctx, db, storeID)
	if err != nil {
		return StoreDeliveryOriginRecord{}, false, err
	}
	if store.DeliveryOriginLatitude == nil || store.DeliveryOriginLongitude == nil {
		return StoreDeliveryOriginRecord{StoreID: store.ID, StoreVersion: store.Version, UpdatedAt: store.UpdatedAt}, false, nil
	}
	return StoreDeliveryOriginRecord{StoreID: store.ID, StoreVersion: store.Version, Latitude: *store.DeliveryOriginLatitude, Longitude: *store.DeliveryOriginLongitude, UpdatedAt: store.UpdatedAt}, true, nil
}

func SetStoreDeliveryOrigin(ctx context.Context, db *sql.DB, storeID, partnerActorID string, latitude, longitude float64, expectedVersion int, idempotencyKey, requestHash, correlationID string) (StoreDeliveryOriginResult, error) {
	storeID = strings.TrimSpace(storeID)
	partnerActorID = strings.TrimSpace(partnerActorID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
	latitude, longitude, err := normalizeLocation(latitude, longitude)
	if db == nil || storeID == "" || partnerActorID == "" || err != nil || expectedVersion < 1 || idempotencyKey == "" || requestHash == "" || correlationID == "" {
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
	var storedExpected, storedVersion int
	var storedLatitude, storedLongitude float64
	var storedUpdatedAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT request_hash, store_id, partner_actor_id, expected_version, result_version, result_latitude, result_longitude, result_updated_at
		FROM dsh.store_origin_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedStoreID, &storedPartner, &storedExpected, &storedVersion, &storedLatitude, &storedLongitude, &storedUpdatedAt)
	if err == nil {
		if storedHash != requestHash || storedStoreID != storeID || storedPartner != partnerActorID || storedExpected != expectedVersion {
			return StoreDeliveryOriginResult{}, ErrStoreOriginIdempotency
		}
		if err := tx.Commit(); err != nil {
			return StoreDeliveryOriginResult{}, fmt.Errorf("commit idempotent store delivery origin: %w", err)
		}
		return StoreDeliveryOriginResult{Origin: StoreDeliveryOriginRecord{StoreID: storeID, StoreVersion: storedVersion, Latitude: storedLatitude, Longitude: storedLongitude, UpdatedAt: storedUpdatedAt}, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreDeliveryOriginResult{}, fmt.Errorf("read store delivery origin idempotency: %w", err)
	}

	store, err := scanStore(tx.QueryRowContext(ctx, storeSelect+" WHERE id=$1 FOR UPDATE", storeID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreDeliveryOriginResult{}, ErrStoreOriginNotFound
	}
	if err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("read store for delivery origin: %w", err)
	}
	if store.PartnerActorID != partnerActorID {
		return StoreDeliveryOriginResult{}, ErrStoreOriginOwnership
	}
	if store.Version != expectedVersion {
		return StoreDeliveryOriginResult{}, ErrStoreOriginVersion
	}
	var result StoreDeliveryOriginRecord
	err = tx.QueryRowContext(ctx, `UPDATE dsh.stores
		SET delivery_origin_latitude=$2, delivery_origin_longitude=$3, version=version+1, updated_at=clock_timestamp()
		WHERE id=$1 AND partner_actor_id=$4 AND version=$5
		RETURNING id, version, delivery_origin_latitude, delivery_origin_longitude, updated_at`, storeID, latitude, longitude, partnerActorID, expectedVersion).Scan(&result.StoreID, &result.StoreVersion, &result.Latitude, &result.Longitude, &result.UpdatedAt)
	if err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("update canonical Store delivery origin: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_origin_mutation_idempotency
		(idempotency_key, request_hash, store_id, partner_actor_id, expected_version, result_version, result_latitude, result_longitude, result_updated_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, idempotencyKey, requestHash, storeID, partnerActorID, expectedVersion, result.StoreVersion, result.Latitude, result.Longitude, result.UpdatedAt); err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("record store delivery origin idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_origin_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, partner_actor_id, store_id, expected_version, result_version, request_hash, latitude, longitude)
		VALUES('store_delivery_origin_set',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, idempotencyKey, correlationID, partnerActorID, partnerActorID, storeID, expectedVersion, result.StoreVersion, requestHash, result.Latitude, result.Longitude); err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("record store delivery origin audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return StoreDeliveryOriginResult{}, fmt.Errorf("commit Store delivery origin: %w", err)
	}
	return StoreDeliveryOriginResult{Origin: result}, nil
}

type deliveryAddressScanner interface {
	Scan(dest ...any) error
}

func scanDeliveryAddress(row deliveryAddressScanner) (DeliveryAddressRecord, error) {
	var address DeliveryAddressRecord
	if err := row.Scan(&address.ID, &address.ClientActorID, &address.AddressText, &address.Latitude, &address.Longitude, &address.Version, &address.CreatedAt, &address.UpdatedAt); err != nil {
		return DeliveryAddressRecord{}, err
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
