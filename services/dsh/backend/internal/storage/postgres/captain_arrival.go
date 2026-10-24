package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrCaptainArrivalUnavailable = errors.New("captain arrival is unavailable")

// RecordCaptainArrival serializes with assignment transitions. A repeated call
// never creates a second customer notification, even with competing retries.
func RecordCaptainArrival(ctx context.Context, db *sql.DB, assignmentID, actorID string) (time.Time, error) {
	assignmentID, actorID = strings.TrimSpace(assignmentID), strings.TrimSpace(actorID)
	if db == nil || assignmentID == "" || actorID == "" {
		return time.Time{}, ErrCaptainArrivalUnavailable
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return time.Time{}, fmt.Errorf("begin captain arrival: %w", err)
	}
	defer tx.Rollback()
	var orderID, state string
	err = tx.QueryRowContext(ctx, `SELECT order_id, state FROM dsh.captain_assignments
        WHERE id=$1 AND captain_actor_id=$2 FOR UPDATE`, assignmentID, actorID).Scan(&orderID, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrCaptainArrivalUnavailable
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("read captain assignment for arrival: %w", err)
	}
	var arrivedAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT arrived_at FROM dsh.captain_delivery_arrivals
        WHERE assignment_id=$1 AND captain_actor_id=$2`, assignmentID, actorID).Scan(&arrivedAt)
	if err == nil {
		if err = tx.Commit(); err != nil {
			return time.Time{}, fmt.Errorf("commit replay arrival: %w", err)
		}
		return arrivedAt, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, fmt.Errorf("read existing captain arrival: %w", err)
	}
	if state != "in_custody" {
		return time.Time{}, ErrCaptainArrivalUnavailable
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO dsh.captain_delivery_arrivals (assignment_id,order_id,captain_actor_id)
        VALUES ($1,$2,$3) RETURNING arrived_at`, assignmentID, orderID, actorID).Scan(&arrivedAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("insert captain arrival: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return time.Time{}, fmt.Errorf("commit captain arrival: %w", err)
	}
	return arrivedAt, nil
}

func ReadCaptainArrival(ctx context.Context, db *sql.DB, assignmentID, actorID string) (*time.Time, error) {
	assignmentID, actorID = strings.TrimSpace(assignmentID), strings.TrimSpace(actorID)
	if db == nil || assignmentID == "" || actorID == "" {
		return nil, ErrCaptainArrivalUnavailable
	}
	var arrivedAt sql.NullTime
	err := db.QueryRowContext(ctx, `SELECT a.arrived_at FROM dsh.captain_assignments assignment
        LEFT JOIN dsh.captain_delivery_arrivals a ON a.assignment_id=assignment.id
        WHERE assignment.id=$1 AND assignment.captain_actor_id=$2`, assignmentID, actorID).Scan(&arrivedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrCaptainArrivalUnavailable
	}
	if err != nil {
		return nil, fmt.Errorf("read captain arrival: %w", err)
	}
	if !arrivedAt.Valid {
		return nil, nil
	}
	return &arrivedAt.Time, nil
}
