package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type ServiceCityRecord struct {
	ID            string
	DisplayNameAr string
	Active        bool
	Version       int
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type ServiceCityResult struct {
	City     ServiceCityRecord
	Replayed bool
}

var (
	ErrServiceCityNotFound    = errors.New("service city was not found")
	ErrServiceCityExists      = errors.New("service city already exists")
	ErrServiceCityIdempotency = errors.New("service city idempotency key was already used with different facts")
	ErrServiceCityVersion     = errors.New("service city version is stale")
	ErrServiceCityInvalid     = errors.New("service city facts are invalid")
)

func HashServiceCityCreateRequest(cityID, displayNameAr string, active bool) string {
	return hashFacts("create-service-city", strings.TrimSpace(cityID), strings.TrimSpace(displayNameAr), strconv.FormatBool(active))
}

func HashServiceCityUpdateRequest(cityID, displayNameAr string, active bool, expectedVersion int) string {
	return hashFacts("update-service-city", strings.TrimSpace(cityID), strings.TrimSpace(displayNameAr), strconv.FormatBool(active), strconv.Itoa(expectedVersion))
}

func ListActiveServiceCities(ctx context.Context, db *sql.DB) ([]ServiceCityRecord, error) {
	return listServiceCities(ctx, db, true)
}

func ListServiceCities(ctx context.Context, db *sql.DB) ([]ServiceCityRecord, error) {
	return listServiceCities(ctx, db, false)
}

func listServiceCities(ctx context.Context, db *sql.DB, activeOnly bool) ([]ServiceCityRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	query := `SELECT id, display_name_ar, active, version, created_at, updated_at FROM dsh.service_cities`
	if activeOnly {
		query += " WHERE active=true"
	}
	query += " ORDER BY lower(display_name_ar), id"
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list active service cities: %w", err)
	}
	defer rows.Close()
	result := make([]ServiceCityRecord, 0)
	for rows.Next() {
		var city ServiceCityRecord
		if err := rows.Scan(&city.ID, &city.DisplayNameAr, &city.Active, &city.Version, &city.CreatedAt, &city.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan active service city: %w", err)
		}
		result = append(result, city)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read active service cities: %w", err)
	}
	return result, nil
}

func ReadServiceCity(ctx context.Context, db *sql.DB, cityID string) (ServiceCityRecord, error) {
	if db == nil {
		return ServiceCityRecord{}, errors.New("DSH database is nil")
	}
	cityID = strings.TrimSpace(cityID)
	if cityID == "" {
		return ServiceCityRecord{}, ErrServiceCityNotFound
	}
	city, err := scanServiceCity(db.QueryRowContext(ctx, serviceCitySelect+" WHERE id=$1", cityID))
	if errors.Is(err, sql.ErrNoRows) {
		return ServiceCityRecord{}, ErrServiceCityNotFound
	}
	if err != nil {
		return ServiceCityRecord{}, fmt.Errorf("read service city: %w", err)
	}
	return city, nil
}

func CreateServiceCity(ctx context.Context, db *sql.DB, cityID, displayNameAr string, active bool, idempotencyKey, requestHash, actingActorID, correlationID string) (ServiceCityResult, error) {
	cityID = strings.TrimSpace(cityID)
	displayNameAr = strings.TrimSpace(displayNameAr)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	actingActorID = strings.TrimSpace(actingActorID)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || !validServiceCityID(cityID) || !validServiceCityName(displayNameAr) || idempotencyKey == "" || requestHash == "" || actingActorID == "" || correlationID == "" {
		return ServiceCityResult{}, ErrServiceCityInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ServiceCityResult{}, fmt.Errorf("begin service city create: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockServiceCityKey(ctx, tx, idempotencyKey); err != nil {
		return ServiceCityResult{}, err
	}
	var storedHash, storedCityID, operation string
	var storedExpected sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT request_hash, city_id, operation, expected_version
		FROM dsh.service_city_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedCityID, &operation, &storedExpected)
	if err == nil {
		if storedHash != requestHash || storedCityID != cityID || operation != "create" || storedExpected.Valid {
			return ServiceCityResult{}, ErrServiceCityIdempotency
		}
		city, readErr := readServiceCityTx(ctx, tx, cityID)
		if readErr != nil {
			return ServiceCityResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return ServiceCityResult{}, err
		}
		return ServiceCityResult{City: city, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ServiceCityResult{}, fmt.Errorf("read service city idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:service-city:id:"+cityID); err != nil {
		return ServiceCityResult{}, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:service-city:name:"+strings.ToLower(displayNameAr)); err != nil {
		return ServiceCityResult{}, err
	}
	var existing string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.service_cities WHERE id=$1 OR lower(btrim(display_name_ar))=lower(btrim($2))", cityID, displayNameAr).Scan(&existing); err == nil {
		return ServiceCityResult{}, ErrServiceCityExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return ServiceCityResult{}, err
	}
	city, err := scanServiceCity(tx.QueryRowContext(ctx, `INSERT INTO dsh.service_cities(id,display_name_ar,active)
		VALUES($1,$2,$3) RETURNING id,display_name_ar,active,version,created_at,updated_at`, cityID, displayNameAr, active))
	if err != nil {
		return ServiceCityResult{}, fmt.Errorf("create service city: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.service_city_mutation_idempotency
		(idempotency_key,request_hash,city_id,operation,result_version,result_display_name_ar,result_active)
		VALUES($1,$2,$3,'create',$4,$5,$6)`, idempotencyKey, requestHash, city.ID, city.Version, city.DisplayNameAr, city.Active); err != nil {
		return ServiceCityResult{}, fmt.Errorf("record service city idempotency: %w", err)
	}
	if err := auditServiceCityTx(ctx, tx, "service_city_created", idempotencyKey, correlationID, actingActorID, city, 0, false, requestHash); err != nil {
		return ServiceCityResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ServiceCityResult{}, fmt.Errorf("commit service city: %w", err)
	}
	return ServiceCityResult{City: city}, nil
}

func UpdateServiceCity(ctx context.Context, db *sql.DB, cityID, displayNameAr string, active bool, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (ServiceCityResult, error) {
	cityID = strings.TrimSpace(cityID)
	displayNameAr = strings.TrimSpace(displayNameAr)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	actingActorID = strings.TrimSpace(actingActorID)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || !validServiceCityID(cityID) || !validServiceCityName(displayNameAr) || expectedVersion < 1 || idempotencyKey == "" || requestHash == "" || actingActorID == "" || correlationID == "" {
		return ServiceCityResult{}, ErrServiceCityInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ServiceCityResult{}, fmt.Errorf("begin service city update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockServiceCityKey(ctx, tx, idempotencyKey); err != nil {
		return ServiceCityResult{}, err
	}
	var storedHash, storedCityID, operation, storedName string
	var storedExpected, storedVersion sql.NullInt64
	var storedActive bool
	err = tx.QueryRowContext(ctx, `SELECT request_hash,city_id,operation,expected_version,result_version,result_display_name_ar,result_active
		FROM dsh.service_city_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedCityID, &operation, &storedExpected, &storedVersion, &storedName, &storedActive)
	if err == nil {
		if storedHash != requestHash || storedCityID != cityID || operation != "update" || !storedExpected.Valid || int(storedExpected.Int64) != expectedVersion {
			return ServiceCityResult{}, ErrServiceCityIdempotency
		}
		city, readErr := readServiceCityTx(ctx, tx, cityID)
		if readErr != nil {
			return ServiceCityResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return ServiceCityResult{}, err
		}
		return ServiceCityResult{City: city, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ServiceCityResult{}, fmt.Errorf("read service city update idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:service-city:id:"+cityID); err != nil {
		return ServiceCityResult{}, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:service-city:name:"+strings.ToLower(displayNameAr)); err != nil {
		return ServiceCityResult{}, err
	}
	current, err := readServiceCityTxForUpdate(ctx, tx, cityID)
	if errors.Is(err, ErrServiceCityNotFound) {
		return ServiceCityResult{}, err
	}
	if err != nil {
		return ServiceCityResult{}, err
	}
	if current.Version != expectedVersion {
		return ServiceCityResult{}, ErrServiceCityVersion
	}
	var existing string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.service_cities WHERE lower(btrim(display_name_ar))=lower(btrim($1)) AND id<>$2", displayNameAr, cityID).Scan(&existing); err == nil {
		return ServiceCityResult{}, ErrServiceCityExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return ServiceCityResult{}, err
	}
	updated, err := scanServiceCity(tx.QueryRowContext(ctx, `UPDATE dsh.service_cities
		SET display_name_ar=$2,active=$3,version=version+1,updated_at=clock_timestamp()
		WHERE id=$1 AND version=$4 RETURNING id,display_name_ar,active,version,created_at,updated_at`, cityID, displayNameAr, active, expectedVersion))
	if err != nil {
		return ServiceCityResult{}, fmt.Errorf("update service city: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.service_city_mutation_idempotency
		(idempotency_key,request_hash,city_id,operation,expected_version,result_version,result_display_name_ar,result_active)
		VALUES($1,$2,$3,'update',$4,$5,$6,$7)`, idempotencyKey, requestHash, updated.ID, expectedVersion, updated.Version, updated.DisplayNameAr, updated.Active); err != nil {
		return ServiceCityResult{}, fmt.Errorf("record service city update idempotency: %w", err)
	}
	if err := auditServiceCityTx(ctx, tx, "service_city_updated", idempotencyKey, correlationID, actingActorID, updated, current.Version, current.Active, requestHash); err != nil {
		return ServiceCityResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ServiceCityResult{}, fmt.Errorf("commit service city update: %w", err)
	}
	return ServiceCityResult{City: updated}, nil
}

func validServiceCityID(value string) bool {
	if len(value) < 2 || len(value) > 128 {
		return false
	}
	for index, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_' || (char == '-' && index > 0) {
			continue
		}
		return false
	}
	return value[0] >= 'a' && value[0] <= 'z' || value[0] >= '0' && value[0] <= '9'
}

func validServiceCityName(value string) bool {
	trimmed := strings.TrimSpace(value)
	return len([]rune(trimmed)) >= 2 && len([]rune(trimmed)) <= 160
}

func lockServiceCityKey(ctx context.Context, tx *sql.Tx, key string) error {
	if strings.TrimSpace(key) == "" {
		return ErrServiceCityInvalid
	}
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:service-city:idempotency:"+key)
	return err
}

const serviceCitySelect = `SELECT id,display_name_ar,active,version,created_at,updated_at FROM dsh.service_cities`

func readServiceCityTx(ctx context.Context, tx *sql.Tx, cityID string) (ServiceCityRecord, error) {
	city, err := scanServiceCity(tx.QueryRowContext(ctx, serviceCitySelect+" WHERE id=$1", strings.TrimSpace(cityID)))
	if errors.Is(err, sql.ErrNoRows) {
		return ServiceCityRecord{}, ErrServiceCityNotFound
	}
	return city, err
}

func readServiceCityTxForUpdate(ctx context.Context, tx *sql.Tx, cityID string) (ServiceCityRecord, error) {
	city, err := scanServiceCity(tx.QueryRowContext(ctx, serviceCitySelect+" WHERE id=$1 FOR UPDATE", strings.TrimSpace(cityID)))
	if errors.Is(err, sql.ErrNoRows) {
		return ServiceCityRecord{}, ErrServiceCityNotFound
	}
	return city, err
}

func scanServiceCity(row rowScanner) (ServiceCityRecord, error) {
	var city ServiceCityRecord
	if err := row.Scan(&city.ID, &city.DisplayNameAr, &city.Active, &city.Version, &city.CreatedAt, &city.UpdatedAt); err != nil {
		return ServiceCityRecord{}, err
	}
	return city, nil
}

func auditServiceCityTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, correlationID, actingActorID string, city ServiceCityRecord, fromVersion int, fromActive bool, requestHash string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.service_city_audit
		(event_type,idempotency_key,correlation_id,acting_actor_id,city_id,from_version,result_version,from_active,to_active,request_hash,display_name_ar)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,0),$7,CASE WHEN $6=0 THEN NULL::boolean ELSE $8 END,$9,$10,$11)`, eventType, idempotencyKey, correlationID, actingActorID, city.ID, fromVersion, city.Version, fromActive, city.Active, requestHash, city.DisplayNameAr)
	if err != nil {
		return fmt.Errorf("record service city audit: %w", err)
	}
	return nil
}
