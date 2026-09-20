package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrCaptainLocationNotFound    = errors.New("captain location assignment was not found")
	ErrCaptainLocationConflict    = errors.New("captain location is not currently publishable")
	ErrCaptainLocationIdempotency = errors.New("captain location idempotency key was already used with different facts")
)

type CaptainLocationSnapshot struct {
	AssignmentID   string
	OrderID        string
	CaptainActorID string
	Latitude       float64
	Longitude      float64
	Version        int
	UpdatedAt      time.Time
}

type CaptainLocationResult struct {
	Location CaptainLocationSnapshot
	Replayed bool
}

type ClientOrderTracking struct {
	OrderID         string
	OrderState      string
	TrackingState   string
	AssignmentID    *string
	CaptainLocation *CaptainLocationSnapshot
}

func HashCaptainLocationRequest(assignmentID string, latitude, longitude float64) string {
	return hashFacts("captain-location", strings.TrimSpace(assignmentID), formatCoordinate(latitude), formatCoordinate(longitude))
}

func UpdateCaptainLocation(ctx context.Context, db *sql.DB, assignmentID, captainActorID string, latitude, longitude float64, idempotencyKey, requestHash, correlationID string) (CaptainLocationResult, error) {
	assignmentID = strings.TrimSpace(assignmentID)
	captainActorID = strings.TrimSpace(captainActorID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
	latitude, longitude, err := normalizeLocation(latitude, longitude)
	if db == nil || assignmentID == "" || captainActorID == "" || idempotencyKey == "" || requestHash == "" || correlationID == "" || err != nil {
		return CaptainLocationResult{}, ErrCaptainLocationConflict
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainLocationResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:captain-location:idempotency:"+idempotencyKey); err != nil {
		return CaptainLocationResult{}, err
	}

	var storedHash, storedAssignmentID, storedOrderID, storedCaptainID string
	var storedVersion int
	var storedLatitude, storedLongitude float64
	var storedUpdatedAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT request_hash, assignment_id, order_id, captain_actor_id, result_version, result_latitude, result_longitude, result_updated_at
		FROM dsh.captain_location_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedAssignmentID, &storedOrderID, &storedCaptainID, &storedVersion, &storedLatitude, &storedLongitude, &storedUpdatedAt)
	if err == nil {
		if storedHash != requestHash || storedAssignmentID != assignmentID || storedCaptainID != captainActorID || storedOrderID == "" {
			return CaptainLocationResult{}, ErrCaptainLocationIdempotency
		}
		if err := tx.Commit(); err != nil {
			return CaptainLocationResult{}, err
		}
		return CaptainLocationResult{Location: CaptainLocationSnapshot{
			AssignmentID: assignmentID, OrderID: storedOrderID, CaptainActorID: storedCaptainID,
			Latitude: storedLatitude, Longitude: storedLongitude, Version: storedVersion, UpdatedAt: storedUpdatedAt,
		}, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainLocationResult{}, err
	}

	var orderID string
	var assignmentState string
	err = tx.QueryRowContext(ctx, `SELECT order_id, state FROM dsh.captain_assignments
		WHERE id=$1 AND captain_actor_id=$2 FOR UPDATE`, assignmentID, captainActorID).Scan(&orderID, &assignmentState)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainLocationResult{}, ErrCaptainLocationNotFound
	}
	if err != nil {
		return CaptainLocationResult{}, err
	}
	if assignmentState != "in_custody" {
		return CaptainLocationResult{}, ErrCaptainLocationConflict
	}

	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT version FROM dsh.captain_location_snapshots WHERE assignment_id=$1 FOR UPDATE`, assignmentID).Scan(&currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		currentVersion = 1
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_location_snapshots
			(assignment_id, order_id, captain_actor_id, latitude, longitude, version, last_idempotency_key, last_request_hash)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, assignmentID, orderID, captainActorID, latitude, longitude, currentVersion, idempotencyKey, requestHash); err != nil {
			return CaptainLocationResult{}, err
		}
	} else if err != nil {
		return CaptainLocationResult{}, err
	} else {
		currentVersion++
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_location_snapshots
			SET latitude=$2, longitude=$3, version=$4, last_idempotency_key=$5, last_request_hash=$6, updated_at=clock_timestamp()
			WHERE assignment_id=$1`, assignmentID, latitude, longitude, currentVersion, idempotencyKey, requestHash); err != nil {
			return CaptainLocationResult{}, err
		}
	}

	var updatedAt time.Time
	if err := tx.QueryRowContext(ctx, `SELECT updated_at FROM dsh.captain_location_snapshots WHERE assignment_id=$1`, assignmentID).Scan(&updatedAt); err != nil {
		return CaptainLocationResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_location_mutation_idempotency
		(idempotency_key, request_hash, assignment_id, order_id, captain_actor_id, result_version, result_latitude, result_longitude, result_updated_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, idempotencyKey, requestHash, assignmentID, orderID, captainActorID, currentVersion, latitude, longitude, updatedAt); err != nil {
		return CaptainLocationResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_location_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, order_id, assignment_id, captain_actor_id, result_version, latitude, longitude, request_hash)
		VALUES('captain_location_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, idempotencyKey, correlationID, captainActorID, orderID, assignmentID, captainActorID, currentVersion, latitude, longitude, requestHash); err != nil {
		return CaptainLocationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainLocationResult{}, err
	}
	return CaptainLocationResult{Location: CaptainLocationSnapshot{
		AssignmentID: assignmentID, OrderID: orderID, CaptainActorID: captainActorID,
		Latitude: latitude, Longitude: longitude, Version: currentVersion, UpdatedAt: updatedAt,
	}}, nil
}

func ReadClientOrderTracking(ctx context.Context, db *sql.DB, orderID, clientActorID string) (ClientOrderTracking, error) {
	orderID = strings.TrimSpace(orderID)
	clientActorID = strings.TrimSpace(clientActorID)
	if db == nil || orderID == "" || clientActorID == "" {
		return ClientOrderTracking{}, ErrOrderNotFound
	}
	var result ClientOrderTracking
	var assignmentID, assignmentState sql.NullString
	var latitude, longitude sql.NullFloat64
	var version sql.NullInt64
	var updatedAt sql.NullTime
	err := db.QueryRowContext(ctx, `SELECT o.id, o.state, a.id, a.state, s.latitude, s.longitude, s.version, s.updated_at
		FROM dsh.commerce_orders o
		LEFT JOIN dsh.captain_assignments a ON a.order_id=o.id AND a.state IN ('assigned', 'in_custody')
		LEFT JOIN dsh.captain_location_snapshots s ON s.assignment_id=a.id
		WHERE o.id=$1 AND o.client_actor_id=$2`, orderID, clientActorID).Scan(&result.OrderID, &result.OrderState, &assignmentID, &assignmentState, &latitude, &longitude, &version, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ClientOrderTracking{}, ErrOrderNotFound
	}
	if err != nil {
		return ClientOrderTracking{}, err
	}
	result.TrackingState = "NOT_ASSIGNED"
	if result.OrderState == "DELIVERED" || result.OrderState == "DELIVERY_FAILED" || result.OrderState == "CANCELLED" {
		result.TrackingState = "COMPLETED"
		return result, nil
	}
	if !assignmentID.Valid {
		return result, nil
	}
	assignment := assignmentID.String
	result.AssignmentID = &assignment
	if !latitude.Valid || !longitude.Valid || !version.Valid || !updatedAt.Valid {
		result.TrackingState = "AWAITING_LOCATION"
		return result, nil
	}
	result.TrackingState = "LIVE"
	result.CaptainLocation = &CaptainLocationSnapshot{
		AssignmentID: assignment,
		OrderID:      orderID,
		Latitude:     latitude.Float64,
		Longitude:    longitude.Float64,
		Version:      int(version.Int64),
		UpdatedAt:    updatedAt.Time,
	}
	return result, nil
}
