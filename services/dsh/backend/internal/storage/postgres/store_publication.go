package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type StoreRecord struct {
	ID                      string
	PartnerActorID          string
	Name                    string
	ServiceCityID           string
	PrimaryVerticalID       string
	Version                 int
	PublicationState        string
	PublicationChangedAt    *time.Time
	DeliveryOriginLatitude  *float64
	DeliveryOriginLongitude *float64
	DeliveryOriginVersion   int
	DeliveryOriginUpdatedAt *time.Time
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

func newID(prefix string) (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate DSH identifier: %w", err)
	}
	return prefix + "_" + hex.EncodeToString(raw[:]), nil
}

var (
	ErrInvalidPublicationState        = errors.New("store publication state is invalid")
	ErrPublicationIdempotencyConflict = errors.New("store publication idempotency key was already used with different facts")
	ErrPublicationVersionConflict     = errors.New("store publication version is stale")
	ErrStoreNotFound                  = errors.New("store was not found")
)

type PublicationResult struct {
	Store    StoreRecord
	Replayed bool
}

// PublicationGuard runs after the canonical Store row has been locked and
// before any publication state, idempotency, or audit row is written.
// Returning an error rolls the transaction back without creating a success
// record. Idempotent replays return before the guard is called.
type PublicationGuard func(context.Context, StoreRecord) error

type PublicStoreRecord struct {
	ID                string
	PartnerActorID    string
	Name              string
	ServiceCity       *ServiceCityRecord
	PrimaryVerticalID string
	Version           int
	PublishedAt       time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func HashStorePublicationRequest(storeID, requestedState string, expectedVersion int) string {
	value := strings.TrimSpace(storeID) + "\x00" + strings.TrimSpace(requestedState) + "\x00" + strconv.Itoa(expectedVersion)
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func ReadStore(ctx context.Context, db *sql.DB, storeID string) (StoreRecord, error) {
	if db == nil {
		return StoreRecord{}, errors.New("DSH database is nil")
	}
	storeID = strings.TrimSpace(storeID)
	if storeID == "" {
		return StoreRecord{}, ErrStoreNotFound
	}
	store, err := scanStore(db.QueryRowContext(ctx, storeSelect+" WHERE id=$1", storeID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreRecord{}, ErrStoreNotFound
	}
	if err != nil {
		return StoreRecord{}, fmt.Errorf("read canonical store: %w", err)
	}
	return store, nil
}

func ReadStoreOwnedByPartner(ctx context.Context, db *sql.DB, storeID, partnerActorID string) (StoreRecord, error) {
	if db == nil {
		return StoreRecord{}, errors.New("DSH database is nil")
	}
	storeID = strings.TrimSpace(storeID)
	partnerActorID = strings.TrimSpace(partnerActorID)
	if storeID == "" || partnerActorID == "" {
		return StoreRecord{}, ErrStoreNotFound
	}
	store, err := scanStore(db.QueryRowContext(ctx, storeSelect+" WHERE id=$1 AND partner_actor_id=$2", storeID, partnerActorID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreRecord{}, ErrStoreNotFound
	}
	if err != nil {
		return StoreRecord{}, fmt.Errorf("read owned canonical store: %w", err)
	}
	return store, nil
}

func SetStorePublication(ctx context.Context, db *sql.DB, storeID, requestedState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (PublicationResult, error) {
	return setStorePublication(ctx, db, storeID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, nil)
}

func SetStorePublicationWithGuard(ctx context.Context, db *sql.DB, storeID, requestedState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string, guard PublicationGuard) (PublicationResult, error) {
	return setStorePublication(ctx, db, storeID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, guard)
}

func setStorePublication(ctx context.Context, db *sql.DB, storeID, requestedState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string, guard PublicationGuard) (PublicationResult, error) {
	storeID = strings.TrimSpace(storeID)
	requestedState = strings.TrimSpace(requestedState)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	actingActorID = strings.TrimSpace(actingActorID)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil {
		return PublicationResult{}, errors.New("DSH database is nil")
	}
	if storeID == "" || idempotencyKey == "" || requestHash == "" || actingActorID == "" || correlationID == "" || expectedVersion < 1 {
		return PublicationResult{}, errors.New("store publication facts are invalid")
	}
	if requestedState != "published" && requestedState != "hidden" {
		return PublicationResult{}, ErrInvalidPublicationState
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PublicationResult{}, fmt.Errorf("begin store publication: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:store-publication:idempotency:"+idempotencyKey); err != nil {
		return PublicationResult{}, fmt.Errorf("lock store publication idempotency: %w", err)
	}

	var storedHash, storedStoreID, storedState, storedResultState string
	var storedExpectedVersion, storedResultVersion int
	var storedChangedAt, storedUpdatedAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT request_hash, store_id, requested_state, expected_version, result_version, result_state, result_publication_changed_at, result_updated_at
		FROM dsh.store_publication_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(
		&storedHash, &storedStoreID, &storedState, &storedExpectedVersion, &storedResultVersion, &storedResultState, &storedChangedAt, &storedUpdatedAt)
	if err == nil {
		if storedHash != requestHash || storedStoreID != storeID || storedState != requestedState || storedExpectedVersion != expectedVersion {
			return PublicationResult{}, ErrPublicationIdempotencyConflict
		}
		store, readErr := scanStore(tx.QueryRowContext(ctx, storeSelect+" WHERE id=$1", storeID))
		if errors.Is(readErr, sql.ErrNoRows) {
			return PublicationResult{}, ErrStoreNotFound
		}
		if readErr != nil {
			return PublicationResult{}, fmt.Errorf("read idempotent store publication: %w", readErr)
		}
		if err := tx.Commit(); err != nil {
			return PublicationResult{}, fmt.Errorf("commit idempotent store publication: %w", err)
		}
		store.Version = storedResultVersion
		store.PublicationState = storedResultState
		store.PublicationChangedAt = &storedChangedAt
		store.UpdatedAt = storedUpdatedAt
		return PublicationResult{Store: store, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PublicationResult{}, fmt.Errorf("read store publication idempotency: %w", err)
	}

	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:store-publication:store:"+storeID); err != nil {
		return PublicationResult{}, fmt.Errorf("lock store publication store: %w", err)
	}
	store, err := scanStore(tx.QueryRowContext(ctx, storeSelect+" WHERE id=$1 FOR UPDATE", storeID))
	if errors.Is(err, sql.ErrNoRows) {
		return PublicationResult{}, ErrStoreNotFound
	}
	if err != nil {
		return PublicationResult{}, fmt.Errorf("read store for publication: %w", err)
	}
	if store.Version != expectedVersion {
		return PublicationResult{}, ErrPublicationVersionConflict
	}
	if guard != nil {
		if err := guard(ctx, store); err != nil {
			return PublicationResult{}, fmt.Errorf("validate store publication readiness: %w", err)
		}
	}

	updated, err := scanStore(tx.QueryRowContext(ctx, `UPDATE dsh.stores
		SET publication_state=$2, publication_changed_at=clock_timestamp(), version=version+1, updated_at=clock_timestamp()
		WHERE id=$1 AND version=$3
		RETURNING id, partner_actor_id, name, service_city_id, primary_vertical_id, version, publication_state, publication_changed_at, created_at, updated_at`, storeID, requestedState, expectedVersion))
	if err != nil {
		return PublicationResult{}, fmt.Errorf("update canonical store publication: %w", err)
	}
	eventType := "store_published"
	if requestedState == "hidden" {
		eventType = "store_hidden"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_publication_idempotency
		(idempotency_key, request_hash, store_id, requested_state, expected_version, result_version, result_state, result_publication_changed_at, result_updated_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, idempotencyKey, requestHash, storeID, requestedState, expectedVersion, updated.Version, updated.PublicationState, updated.PublicationChangedAt, updated.UpdatedAt); err != nil {
		return PublicationResult{}, fmt.Errorf("record store publication idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_publication_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, store_id, from_state, to_state, expected_version, result_version, request_hash, requested_state)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, eventType, idempotencyKey, correlationID, actingActorID, storeID, store.PublicationState, updated.PublicationState, expectedVersion, updated.Version, requestHash, requestedState); err != nil {
		return PublicationResult{}, fmt.Errorf("record store publication audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return PublicationResult{}, fmt.Errorf("commit store publication: %w", err)
	}
	return PublicationResult{Store: updated}, nil
}

func ListPublishedStores(ctx context.Context, db *sql.DB, serviceCityIDs ...string) ([]PublicStoreRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	serviceCityID := ""
	if len(serviceCityIDs) == 1 {
		serviceCityID = strings.TrimSpace(serviceCityIDs[0])
	}
	if serviceCityID == "" {
		return nil, ErrServiceCityNotFound
	}
	visibleOfferConditions := strings.Join(customerVisibleOfferConditions(), " AND ")
	rows, err := db.QueryContext(ctx, `SELECT s.id, s.partner_actor_id, s.name, s.primary_vertical_id, s.version, s.publication_changed_at, s.created_at, s.updated_at,
		sc.id, sc.display_name_ar, sc.active, sc.version, sc.created_at, sc.updated_at
		FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id
		WHERE s.service_city_id=$1 AND sc.active=true AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL
		AND EXISTS (SELECT 1 FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id WHERE o.store_id=s.id AND `+visibleOfferConditions+`)
		ORDER BY s.name ASC, s.id ASC`, serviceCityID)
	if err != nil {
		return nil, fmt.Errorf("list published stores: %w", err)
	}
	stores := make([]PublicStoreRecord, 0)
	for rows.Next() {
		var store PublicStoreRecord
		var city ServiceCityRecord
		if err := rows.Scan(&store.ID, &store.PartnerActorID, &store.Name, &store.PrimaryVerticalID, &store.Version, &store.PublishedAt, &store.CreatedAt, &store.UpdatedAt, &city.ID, &city.DisplayNameAr, &city.Active, &city.Version, &city.CreatedAt, &city.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan published store: %w", err)
		}
		store.ServiceCity = &city
		stores = append(stores, store)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read published stores: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close published stores: %w", err)
	}
	return stores, nil
}

func ReadPublishedStore(ctx context.Context, db *sql.DB, storeID string, serviceCityIDs ...string) (PublicStoreRecord, error) {
	if db == nil {
		return PublicStoreRecord{}, errors.New("DSH database is nil")
	}
	serviceCityID := ""
	if len(serviceCityIDs) == 1 {
		serviceCityID = strings.TrimSpace(serviceCityIDs[0])
	}
	if serviceCityID == "" {
		return PublicStoreRecord{}, ErrServiceCityNotFound
	}
	var store PublicStoreRecord
	var city ServiceCityRecord
	visibleOfferConditions := strings.Join(customerVisibleOfferConditions(), " AND ")
	err := db.QueryRowContext(ctx, `SELECT s.id, s.partner_actor_id, s.name, s.primary_vertical_id, s.version, s.publication_changed_at, s.created_at, s.updated_at,
		sc.id, sc.display_name_ar, sc.active, sc.version, sc.created_at, sc.updated_at
		FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id
		WHERE s.id=$1 AND s.service_city_id=$2 AND sc.active=true AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL
		AND EXISTS (SELECT 1 FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id WHERE o.store_id=s.id AND `+visibleOfferConditions+`)`, strings.TrimSpace(storeID), serviceCityID).Scan(
		&store.ID, &store.PartnerActorID, &store.Name, &store.PrimaryVerticalID, &store.Version, &store.PublishedAt, &store.CreatedAt, &store.UpdatedAt, &city.ID, &city.DisplayNameAr, &city.Active, &city.Version, &city.CreatedAt, &city.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicStoreRecord{}, ErrStoreNotFound
	}
	if err != nil {
		return PublicStoreRecord{}, fmt.Errorf("read published store: %w", err)
	}
	store.ServiceCity = &city
	return store, nil
}

const storeSelect = `SELECT id, partner_actor_id, name, service_city_id, primary_vertical_id, version, publication_state, publication_changed_at, created_at, updated_at, delivery_origin_latitude, delivery_origin_longitude, delivery_origin_version, delivery_origin_updated_at FROM dsh.stores`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanStore(row rowScanner) (StoreRecord, error) {
	var store StoreRecord
	var serviceCityID, primaryVerticalID sql.NullString
	var publicationChangedAt sql.NullTime
	var deliveryOriginLatitude, deliveryOriginLongitude sql.NullFloat64
	var deliveryOriginUpdatedAt sql.NullTime
	if err := row.Scan(&store.ID, &store.PartnerActorID, &store.Name, &serviceCityID, &primaryVerticalID, &store.Version, &store.PublicationState, &publicationChangedAt, &store.CreatedAt, &store.UpdatedAt, &deliveryOriginLatitude, &deliveryOriginLongitude, &store.DeliveryOriginVersion, &deliveryOriginUpdatedAt); err != nil {
		return StoreRecord{}, err
	}
	if serviceCityID.Valid {
		store.ServiceCityID = serviceCityID.String
	}
	if primaryVerticalID.Valid {
		store.PrimaryVerticalID = primaryVerticalID.String
	}
	if publicationChangedAt.Valid {
		store.PublicationChangedAt = &publicationChangedAt.Time
	}
	if deliveryOriginLatitude.Valid && deliveryOriginLongitude.Valid {
		store.DeliveryOriginLatitude = &deliveryOriginLatitude.Float64
		store.DeliveryOriginLongitude = &deliveryOriginLongitude.Float64
	}
	if deliveryOriginUpdatedAt.Valid {
		store.DeliveryOriginUpdatedAt = &deliveryOriginUpdatedAt.Time
	}
	return store, nil
}
