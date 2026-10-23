package postgres

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"
	"time"
)

var (
	ErrMissionLocationInvalid   = errors.New("mission location is invalid")
	ErrMissionLocationForbidden = errors.New("mission is not actively assigned to this captain")
	ErrMissionLocationStale     = errors.New("mission location sequence is outdated")
)

type CaptainMissionLocation struct {
	AssignmentID   string     `json:"assignmentId,omitempty"`
	State          string     `json:"state"`
	Latitude       *float64   `json:"latitude,omitempty"`
	Longitude      *float64   `json:"longitude,omitempty"`
	AccuracyMeters *float64   `json:"accuracyMeters,omitempty"`
	RecordedAt     *time.Time `json:"recordedAt,omitempty"`
	ReceivedAt     *time.Time `json:"receivedAt,omitempty"`
}

// One latest coordinate, never a route trail. Assignment lock prevents a
// completion or reassignment from racing an accepted position update.
func UpdateCaptainMissionLocation(ctx context.Context, db *sql.DB, assignmentID, captainActorID string, latitude, longitude, accuracyMeters float64, recordedAt time.Time, sequence int64) error {
	assignmentID = strings.TrimSpace(assignmentID)
	captainActorID = strings.TrimSpace(captainActorID)
	now := time.Now().UTC()
	if db == nil || assignmentID == "" || len(assignmentID) > 128 || captainActorID == "" || len(captainActorID) > 128 ||
		math.IsNaN(latitude) || math.IsInf(latitude, 0) || math.Abs(latitude) > 90 ||
		math.IsNaN(longitude) || math.IsInf(longitude, 0) || math.Abs(longitude) > 180 ||
		(latitude == 0 && longitude == 0) || math.IsNaN(accuracyMeters) || math.IsInf(accuracyMeters, 0) ||
		accuracyMeters < 0 || accuracyMeters > 5000 || sequence <= 0 || recordedAt.IsZero() ||
		recordedAt.Before(now.Add(-2*time.Minute)) || recordedAt.After(now.Add(time.Minute)) {
		return ErrMissionLocationInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var state, orderState, fulfillment string
	err = tx.QueryRowContext(ctx, `SELECT a.state,o.state,o.fulfillment_mode
        FROM dsh.captain_assignments a JOIN dsh.commerce_orders o ON o.id=a.order_id
        WHERE a.id=$1 AND a.captain_actor_id=$2 FOR SHARE OF a`,
		assignmentID, captainActorID).Scan(&state, &orderState, &fulfillment)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrMissionLocationForbidden
	}
	if err != nil {
		return err
	}
	if (state != "assigned" && state != "in_custody") ||
		(orderState != "CAPTAIN_ASSIGNED" && orderState != "IN_CUSTODY") ||
		fulfillment != "BTHWANI_CAPTAIN" {
		return ErrMissionLocationForbidden
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_mission_latest
      (assignment_id,captain_actor_id,latitude,longitude,accuracy_meters,recorded_at,sequence)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(assignment_id) DO UPDATE SET
        latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
        accuracy_meters=EXCLUDED.accuracy_meters,recorded_at=EXCLUDED.recorded_at,
        received_at=clock_timestamp(),sequence=EXCLUDED.sequence
      WHERE dsh.captain_mission_latest.captain_actor_id=EXCLUDED.captain_actor_id
        AND dsh.captain_mission_latest.sequence<EXCLUDED.sequence
        AND dsh.captain_mission_latest.recorded_at<=EXCLUDED.recorded_at`,
		assignmentID, captainActorID, latitude, longitude, accuracyMeters, recordedAt, sequence)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return ErrMissionLocationStale
	}
	return tx.Commit()
}

func ReadOperatorMissionLocation(ctx context.Context, db *sql.DB, orderID string) (CaptainMissionLocation, error) {
	result := CaptainMissionLocation{State: "NO_ACTIVE"}
	if db == nil || len(strings.TrimSpace(orderID)) == 0 || len(orderID) > 128 {
		return result, ErrMissionLocationInvalid
	}
	var assignmentID sql.NullString
	var latitude, longitude, accuracy sql.NullFloat64
	var recordedAt, receivedAt sql.NullTime
	err := db.QueryRowContext(ctx, `SELECT a.id,ml.latitude,ml.longitude,ml.accuracy_meters,ml.recorded_at,ml.received_at
      FROM dsh.commerce_orders o
      LEFT JOIN LATERAL (
        SELECT id FROM dsh.captain_assignments
        WHERE order_id=o.id AND state IN ('assigned','in_custody')
        ORDER BY created_at DESC LIMIT 1
      ) a ON o.fulfillment_mode='BTHWANI_CAPTAIN' AND o.state IN ('CAPTAIN_ASSIGNED','IN_CUSTODY')
      LEFT JOIN dsh.captain_mission_latest ml ON ml.assignment_id=a.id
      WHERE o.id=$1`, orderID).Scan(&assignmentID, &latitude, &longitude, &accuracy, &recordedAt, &receivedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return result, ErrOrderNotFound
	}
	if err != nil {
		return result, err
	}
	if !assignmentID.Valid {
		return result, nil
	}
	result.AssignmentID = assignmentID.String
	result.State = "NO_SIGNAL"
	if !receivedAt.Valid || !recordedAt.Valid || !latitude.Valid || !longitude.Valid || !accuracy.Valid {
		return result, nil
	}
	// The source fix may have been delayed before reaching DSH. Freshness
	// requires BOTH a recent device fix and a recent server receipt.
	now := time.Now().UTC()
	receivedAge := now.Sub(receivedAt.Time)
	fixAge := now.Sub(recordedAt.Time)
	if receivedAge < -time.Minute || receivedAge > 3*time.Minute ||
		fixAge < -time.Minute || fixAge > 3*time.Minute {
		result.State = "LOST"
		return result, nil
	}
	result.RecordedAt = &recordedAt.Time
	result.ReceivedAt = &receivedAt.Time
	result.Latitude = &latitude.Float64
	result.Longitude = &longitude.Float64
	result.AccuracyMeters = &accuracy.Float64
	if receivedAge > 90*time.Second || fixAge > 90*time.Second {
		result.State = "STALE"
	} else {
		result.State = "FRESH"
	}
	return result, nil
}

func PurgeExpiredCaptainMissionLocations(ctx context.Context, db *sql.DB) (int64, error) {
	result, err := db.ExecContext(ctx, `DELETE FROM dsh.captain_mission_latest ml
      WHERE ml.received_at<clock_timestamp()-interval '15 minutes'
      OR NOT EXISTS(SELECT 1 FROM dsh.captain_assignments a
       JOIN dsh.commerce_orders o ON o.id=a.order_id
       WHERE a.id=ml.assignment_id AND a.state IN ('assigned','in_custody')
       AND o.fulfillment_mode='BTHWANI_CAPTAIN' AND o.state IN ('CAPTAIN_ASSIGNED','IN_CUSTODY'))`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
