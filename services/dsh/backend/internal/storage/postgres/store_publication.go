package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lib/pq"
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
	StoreProfileImage       *StoreProfileMediaRecord
	FulfillmentModes        []string
}

type PartnerStorePage struct {
	Stores     []StoreRecord
	NextCursor string
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
	ErrOperatorStoreInvalidLimit      = errors.New("operator store limit is invalid")
	ErrOperatorStoreInvalidQuery      = errors.New("operator store query is invalid")
	ErrOperatorStoreInvalidState      = errors.New("operator store publication state is invalid")
	ErrOperatorStoreInvalidSort       = errors.New("operator store sort is invalid")
	ErrOperatorStoreInvalidCursor     = errors.New("operator store cursor is invalid")
	ErrOperatorStoreInvalidActor      = errors.New("operator store actor is invalid")
)

type OperatorStoreSummary struct {
	ID                string
	PartnerActorID    string
	Name              string
	ServiceCityID     string
	PrimaryVerticalID string
	Version           int
	PublicationState  string
	FulfillmentModes  []string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type OperatorStorePage struct {
	Stores     []OperatorStoreSummary
	NextCursor string
}

type operatorStoreCursor struct {
	UpdatedAt     time.Time `json:"updatedAt"`
	Name          string    `json:"name,omitempty"`
	ID            string    `json:"id"`
	State         string    `json:"state,omitempty"`
	Query         string    `json:"query,omitempty"`
	ServiceCityID string    `json:"serviceCityId,omitempty"`
	SearchMode    string    `json:"searchMode,omitempty"`
	Sort          string    `json:"sort,omitempty"`
	Scope         string    `json:"scope,omitempty"`
}

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
	RatingAverage     float64
	RatingCount       int
	PublishedAt       time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
	StoreProfileImage *StoreProfileMediaRecord
	DistanceMeters    *int
	FulfillmentModes  []string
	CategoryIDs       []string
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
	store.StoreProfileImage, err = ReadStoreProfileMedia(ctx, db, "", store.ID)
	if err != nil {
		return StoreRecord{}, err
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
	store.StoreProfileImage, err = ReadStoreProfileMedia(ctx, db, "", store.ID)
	if err != nil {
		return StoreRecord{}, err
	}
	return store, nil
}

func ListStoresForPartnerActor(ctx context.Context, db *sql.DB, partnerActorID string, limit int, cursor string) (PartnerStorePage, error) {
	partnerActorID = strings.TrimSpace(partnerActorID)
	cursor = strings.TrimSpace(cursor)
	if db == nil || partnerActorID == "" || len(partnerActorID) > 128 || limit < 1 || limit > 50 || len(cursor) > 128 {
		return PartnerStorePage{}, errors.New("partner store page input is invalid")
	}
	rows, err := db.QueryContext(ctx, storeSelect+` WHERE partner_actor_id=$1 AND id>$2 ORDER BY id LIMIT $3`, partnerActorID, cursor, limit+1)
	if err != nil {
		return PartnerStorePage{}, fmt.Errorf("list canonical partner stores: %w", err)
	}
	defer rows.Close()
	page := PartnerStorePage{Stores: make([]StoreRecord, 0, limit)}
	for rows.Next() {
		store, scanErr := scanStore(rows)
		if scanErr != nil {
			return PartnerStorePage{}, scanErr
		}
		if len(page.Stores) == limit {
			page.NextCursor = page.Stores[len(page.Stores)-1].ID
			break
		}
		page.Stores = append(page.Stores, store)
	}
	if err := rows.Err(); err != nil {
		return PartnerStorePage{}, err
	}
	return page, nil
}

func ListStoresForOperator(ctx context.Context, db *sql.DB, state, query, serviceCityID, searchMode, sort string, limit int, cursor string) (OperatorStorePage, error) {
	if db == nil || limit < 1 || limit > 50 {
		return OperatorStorePage{}, ErrOperatorStoreInvalidLimit
	}
	state = strings.TrimSpace(state)
	if state != "" && state != "unpublished" && state != "published" && state != "hidden" {
		return OperatorStorePage{}, ErrOperatorStoreInvalidState
	}
	query = strings.TrimSpace(query)
	serviceCityID = strings.TrimSpace(serviceCityID)
	if utf8.RuneCountInString(query) > 128 {
		return OperatorStorePage{}, ErrOperatorStoreInvalidQuery
	}
	if strings.ContainsRune(query, 0) || len(serviceCityID) > 128 || strings.ContainsRune(serviceCityID, 0) {
		return OperatorStorePage{}, ErrOperatorStoreInvalidQuery
	}
	searchMode = strings.TrimSpace(searchMode)
	if searchMode == "" {
		searchMode = "contains"
	}
	if searchMode != "contains" && searchMode != "name_prefix" {
		return OperatorStorePage{}, ErrOperatorStoreInvalidQuery
	}
	sort = strings.TrimSpace(sort)
	if sort == "" {
		sort = "updated_desc"
	}
	if sort != "updated_desc" && sort != "updated_asc" && sort != "name_asc" {
		return OperatorStorePage{}, ErrOperatorStoreInvalidSort
	}
	if searchMode == "name_prefix" && (state != "published" || utf8.RuneCountInString(query) < 2 || serviceCityID == "" || sort != "name_asc") {
		return OperatorStorePage{}, ErrOperatorStoreInvalidQuery
	}
	if searchMode == "contains" && sort == "name_asc" {
		return OperatorStorePage{}, ErrOperatorStoreInvalidSort
	}
	if len(cursor) > 1024 {
		return OperatorStorePage{}, ErrOperatorStoreInvalidCursor
	}
	cursor = strings.TrimSpace(cursor)
	ascending := sort == "updated_asc"
	args := []any{}
	where := "TRUE"
	if state != "" {
		args = append(args, state)
		where += " AND s.publication_state=$" + strconv.Itoa(len(args))
	}
	if query != "" {
		if searchMode == "name_prefix" {
			args = append(args, strings.ToLower(escapeOperatorStoreSearch(query))+"%")
			where += " AND lower(s.name) LIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!'"
		} else {
			args = append(args, "%"+escapeOperatorStoreSearch(query)+"%")
			where += " AND (s.id ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!' OR s.name ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!' OR s.partner_actor_id ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!')"
		}
	}
	if serviceCityID != "" {
		args = append(args, serviceCityID)
		where += " AND s.service_city_id=$" + strconv.Itoa(len(args))
	}
	if strings.TrimSpace(cursor) != "" {
		decoded, err := decodeOperatorStoreCursor(cursor, state, query, serviceCityID, searchMode, sort)
		if err != nil {
			return OperatorStorePage{}, err
		}
		if sort == "name_asc" {
			anchorName := decoded.Name
			if decoded.Scope != "" {
				prefix := strings.ToLower(escapeOperatorStoreSearch(query)) + "%"
				err := db.QueryRowContext(ctx, "SELECT name FROM dsh.stores WHERE id=$1 AND publication_state='published' AND service_city_id=$2 AND lower(name) LIKE $3 ESCAPE '!'", decoded.ID, serviceCityID, prefix).Scan(&anchorName)
				if errors.Is(err, sql.ErrNoRows) {
					return OperatorStorePage{}, ErrOperatorStoreInvalidCursor
				}
				if err != nil {
					return OperatorStorePage{}, fmt.Errorf("read operator store cursor anchor: %w", err)
				}
			}
			args = append(args, anchorName, decoded.ID)
			where += " AND (lower(s.name),s.id)>(lower($" + strconv.Itoa(len(args)-1) + "),$" + strconv.Itoa(len(args)) + ")"
		} else {
			args = append(args, decoded.UpdatedAt, decoded.ID)
			operator := "<"
			if ascending {
				operator = ">"
			}
			where += " AND (s.updated_at,s.id)" + operator + "($" + strconv.Itoa(len(args)-1) + ",$" + strconv.Itoa(len(args)) + ")"
		}
	}
	args = append(args, limit+1)
	order := "DESC"
	if ascending {
		order = "ASC"
	}
	orderBy := "s.updated_at " + order + ",s.id " + order
	if sort == "name_asc" {
		orderBy = "lower(s.name) ASC,s.id ASC"
	}
	rows, err := db.QueryContext(ctx, `SELECT s.id,s.partner_actor_id,s.name,s.service_city_id,s.primary_vertical_id,s.version,s.publication_state,s.fulfillment_modes,s.created_at,s.updated_at
		FROM dsh.stores s WHERE `+where+" ORDER BY "+orderBy+" LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return OperatorStorePage{}, fmt.Errorf("list canonical operator stores: %w", err)
	}
	defer rows.Close()
	page := OperatorStorePage{Stores: make([]OperatorStoreSummary, 0, limit)}
	for rows.Next() {
		var store OperatorStoreSummary
		var cityID, verticalID sql.NullString
		if err := rows.Scan(&store.ID, &store.PartnerActorID, &store.Name, &cityID, &verticalID, &store.Version, &store.PublicationState, pq.Array(&store.FulfillmentModes), &store.CreatedAt, &store.UpdatedAt); err != nil {
			return OperatorStorePage{}, err
		}
		if len(page.Stores) == limit {
			last := page.Stores[len(page.Stores)-1]
			page.NextCursor = encodeOperatorStoreCursor(operatorStoreCursor{UpdatedAt: last.UpdatedAt, ID: last.ID}, state, query, serviceCityID, searchMode, sort)
			break
		}
		if cityID.Valid {
			store.ServiceCityID = cityID.String
		}
		if verticalID.Valid {
			store.PrimaryVerticalID = verticalID.String
		}
		page.Stores = append(page.Stores, store)
	}
	if err := rows.Err(); err != nil {
		return OperatorStorePage{}, err
	}
	return page, nil
}

func encodeOperatorStoreCursor(cursor operatorStoreCursor, state, query, serviceCityID, searchMode, sort string) string {
	cursor.Scope = operatorStoreCursorScope(state, query, serviceCityID, searchMode, sort)
	value, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(value)
}

func operatorStoreCursorScope(state, query, serviceCityID, searchMode, sort string) string {
	value, _ := json.Marshal([5]string{state, query, serviceCityID, searchMode, sort})
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func decodeOperatorStoreCursor(raw, state, query, serviceCityID, searchMode, sort string) (operatorStoreCursor, error) {
	value, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return operatorStoreCursor{}, ErrOperatorStoreInvalidCursor
	}
	var cursor operatorStoreCursor
	if err := json.Unmarshal(value, &cursor); err != nil {
		return operatorStoreCursor{}, ErrOperatorStoreInvalidCursor
	}
	if cursor.ID == "" || (sort != "name_asc" && cursor.UpdatedAt.IsZero()) {
		return operatorStoreCursor{}, ErrOperatorStoreInvalidCursor
	}
	if cursor.Scope != "" {
		if cursor.Scope != operatorStoreCursorScope(state, query, serviceCityID, searchMode, sort) {
			return operatorStoreCursor{}, ErrOperatorStoreInvalidCursor
		}
		return cursor, nil
	}
	if cursor.SearchMode == "" {
		cursor.SearchMode = "contains"
	}
	if sort == "name_asc" || cursor.State != state || cursor.Query != query || cursor.ServiceCityID != serviceCityID || cursor.SearchMode != searchMode || cursor.Sort != sort {
		return operatorStoreCursor{}, ErrOperatorStoreInvalidCursor
	}
	return cursor, nil
}

func escapeOperatorStoreSearch(value string) string {
	value = strings.ReplaceAll(value, "!", "!!")
	value = strings.ReplaceAll(value, "%", "!%")
	return strings.ReplaceAll(value, "_", "!_")
}

func ReadStorePartnerActor(ctx context.Context, db *sql.DB, storeID string) (string, error) {
	if db == nil || strings.TrimSpace(storeID) == "" {
		return "", ErrStoreNotFound
	}
	var partnerActorID string
	err := db.QueryRowContext(ctx, "SELECT partner_actor_id FROM dsh.stores WHERE id=$1", strings.TrimSpace(storeID)).Scan(&partnerActorID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrStoreNotFound
	}
	return partnerActorID, err
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
		RETURNING id, partner_actor_id, name, service_city_id, primary_vertical_id, version, publication_state, publication_changed_at, created_at, updated_at,
			delivery_origin_latitude, delivery_origin_longitude, delivery_origin_version, delivery_origin_updated_at, fulfillment_modes`, storeID, requestedState, expectedVersion))
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
	if requestedState == "published" && store.PublicationState != "published" {
		if err := enqueueFieldCommissionPublicationTx(ctx, tx, storeID, correlationID); err != nil {
			return PublicationResult{}, fmt.Errorf("enqueue Field commission publication: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return PublicationResult{}, fmt.Errorf("commit store publication: %w", err)
	}
	return PublicationResult{Store: updated}, nil
}

func ListPublishedStores(ctx context.Context, db *sql.DB, serviceCityIDs ...string) ([]PublicStoreRecord, error) {
	serviceCityID := ""
	if len(serviceCityIDs) == 1 {
		serviceCityID = strings.TrimSpace(serviceCityIDs[0])
	}
	return listPublishedStores(ctx, db, serviceCityID, nil, nil)
}

func ListPublishedStoresNear(ctx context.Context, db *sql.DB, serviceCityID string, latitude, longitude float64) ([]PublicStoreRecord, error) {
	return listPublishedStores(ctx, db, strings.TrimSpace(serviceCityID), &latitude, &longitude)
}

func listPublishedStores(ctx context.Context, db *sql.DB, serviceCityID string, latitude, longitude *float64) ([]PublicStoreRecord, error) {
	if db == nil {
		return nil, errors.New("DSH database is nil")
	}
	if serviceCityID == "" {
		return nil, ErrServiceCityNotFound
	}
	visibleOfferConditions := strings.Join(customerVisibleOfferConditions(), " AND ")
	distanceExpression := "NULL::double precision"
	args := []any{serviceCityID}
	if latitude != nil && longitude != nil {
		distanceExpression = `CASE WHEN s.delivery_origin_latitude IS NULL OR s.delivery_origin_longitude IS NULL THEN NULL ELSE (6371000.0 * acos(LEAST(1.0, GREATEST(-1.0, cos(radians($2)) * cos(radians(s.delivery_origin_latitude)) * cos(radians(s.delivery_origin_longitude) - radians($3)) + sin(radians($2)) * sin(radians(s.delivery_origin_latitude))))))::double precision END`
		args = append(args, *latitude, *longitude)
	}
	rows, err := db.QueryContext(ctx, `SELECT s.id, s.partner_actor_id, s.name, s.primary_vertical_id, s.version,
		COALESCE(ratings.rating_average, 0), COALESCE(ratings.rating_count, 0),
		s.publication_changed_at, s.created_at, s.updated_at, s.fulfillment_modes,
		ARRAY(SELECT DISTINCT pc.category_id FROM dsh.catalog_store_offers o
			JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
			JOIN dsh.catalog_products p ON p.id=v.product_id
			JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id
			JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=p.vertical_id
			WHERE o.store_id=s.id AND `+visibleOfferConditions+` ORDER BY pc.category_id),
		`+distanceExpression+`,
		sc.id, sc.display_name_ar, sc.active, sc.version, sc.created_at, sc.updated_at
		FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id
		LEFT JOIN (SELECT store_id, AVG(rating)::double precision AS rating_average, COUNT(*)::int AS rating_count
			FROM dsh.commerce_order_ratings GROUP BY store_id) ratings ON ratings.store_id=s.id
		WHERE s.service_city_id=$1 AND sc.active=true AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL
		AND EXISTS (SELECT 1 FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id WHERE o.store_id=s.id AND `+visibleOfferConditions+`)
		ORDER BY `+distanceExpression+` NULLS LAST, s.name ASC, s.id ASC`, args...)
	if err != nil {
		return nil, fmt.Errorf("list published stores: %w", err)
	}
	stores := make([]PublicStoreRecord, 0)
	for rows.Next() {
		var store PublicStoreRecord
		var city ServiceCityRecord
		var distance sql.NullFloat64
		if err := rows.Scan(&store.ID, &store.PartnerActorID, &store.Name, &store.PrimaryVerticalID, &store.Version, &store.RatingAverage, &store.RatingCount, &store.PublishedAt, &store.CreatedAt, &store.UpdatedAt, pq.Array(&store.FulfillmentModes), pq.Array(&store.CategoryIDs), &distance, &city.ID, &city.DisplayNameAr, &city.Active, &city.Version, &city.CreatedAt, &city.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan published store: %w", err)
		}
		store.ServiceCity = &city
		if distance.Valid {
			value := int(distance.Float64)
			store.DistanceMeters = &value
		}
		store.StoreProfileImage, err = ReadStoreProfileMedia(ctx, db, "", store.ID)
		if err != nil {
			return nil, err
		}
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
	err := db.QueryRowContext(ctx, `SELECT s.id, s.partner_actor_id, s.name, s.primary_vertical_id, s.version,
		COALESCE(ratings.rating_average, 0), COALESCE(ratings.rating_count, 0),
		s.publication_changed_at, s.created_at, s.updated_at, s.fulfillment_modes,
		ARRAY(SELECT DISTINCT pc.category_id FROM dsh.catalog_store_offers o
			JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
			JOIN dsh.catalog_products p ON p.id=v.product_id
			JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id
			JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=p.vertical_id
			WHERE o.store_id=s.id AND `+visibleOfferConditions+` ORDER BY pc.category_id),
		sc.id, sc.display_name_ar, sc.active, sc.version, sc.created_at, sc.updated_at
		FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id
		LEFT JOIN (SELECT store_id, AVG(rating)::double precision AS rating_average, COUNT(*)::int AS rating_count
			FROM dsh.commerce_order_ratings GROUP BY store_id) ratings ON ratings.store_id=s.id
		WHERE s.id=$1 AND s.service_city_id=$2 AND sc.active=true AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL
		AND EXISTS (SELECT 1 FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id WHERE o.store_id=s.id AND `+visibleOfferConditions+`)`, strings.TrimSpace(storeID), serviceCityID).Scan(
		&store.ID, &store.PartnerActorID, &store.Name, &store.PrimaryVerticalID, &store.Version, &store.RatingAverage, &store.RatingCount, &store.PublishedAt, &store.CreatedAt, &store.UpdatedAt, pq.Array(&store.FulfillmentModes), pq.Array(&store.CategoryIDs), &city.ID, &city.DisplayNameAr, &city.Active, &city.Version, &city.CreatedAt, &city.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicStoreRecord{}, ErrStoreNotFound
	}
	if err != nil {
		return PublicStoreRecord{}, fmt.Errorf("read published store: %w", err)
	}
	store.ServiceCity = &city
	store.StoreProfileImage, err = ReadStoreProfileMedia(ctx, db, "", store.ID)
	if err != nil {
		return PublicStoreRecord{}, err
	}
	return store, nil
}

const storeSelect = `SELECT id, partner_actor_id, name, service_city_id, primary_vertical_id, version, publication_state, publication_changed_at, created_at, updated_at, delivery_origin_latitude, delivery_origin_longitude, delivery_origin_version, delivery_origin_updated_at, fulfillment_modes FROM dsh.stores`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanStore(row rowScanner) (StoreRecord, error) {
	var store StoreRecord
	var serviceCityID, primaryVerticalID sql.NullString
	var publicationChangedAt sql.NullTime
	var deliveryOriginLatitude, deliveryOriginLongitude sql.NullFloat64
	var deliveryOriginUpdatedAt sql.NullTime
	if err := row.Scan(&store.ID, &store.PartnerActorID, &store.Name, &serviceCityID, &primaryVerticalID, &store.Version, &store.PublicationState, &publicationChangedAt, &store.CreatedAt, &store.UpdatedAt, &deliveryOriginLatitude, &deliveryOriginLongitude, &store.DeliveryOriginVersion, &deliveryOriginUpdatedAt, pq.Array(&store.FulfillmentModes)); err != nil {
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
