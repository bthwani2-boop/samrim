package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

var (
	ErrDiscoveryContentEventInvalid  = errors.New("discovery content event is invalid")
	ErrDiscoveryContentEventNotFound = errors.New("discovery content event content was not found")
	ErrDiscoveryContentEventConflict = errors.New("discovery content event idempotency key conflicts with canonical facts")
)

type DiscoveryContentEventInput struct {
	ID              string
	ClientEventID   string
	ContentID       string
	EventType       string
	ClientSessionID string
	ClientActorID   string
	OrderID         string
}

type DiscoveryContentAnalyticsRecord struct {
	ContentID string
	EventType string
	Count     int64
}

func discoveryEventFactsMatch(input DiscoveryContentEventInput, contentID, eventType, sessionID string, actorID, orderID sql.NullString) bool {
	return input.ContentID == contentID &&
		input.EventType == eventType &&
		input.ClientSessionID == sessionID &&
		input.ClientActorID == actorID.String &&
		(input.ClientActorID != "") == actorID.Valid &&
		input.OrderID == orderID.String &&
		(input.OrderID != "") == orderID.Valid
}

// Replay is allowed even after a published campaign has ended. The unique
// event identity still has to point to exactly the original immutable facts.
func readDiscoveryContentEventReplay(ctx context.Context, db *sql.DB, input DiscoveryContentEventInput) (bool, error) {
	var contentID, eventType, sessionID string
	var actorID, orderID sql.NullString
	err := db.QueryRowContext(ctx, `SELECT content_id,event_type,client_session_id,client_actor_id,order_id
		FROM dsh.discovery_content_events WHERE client_event_id=$1`, input.ClientEventID).
		Scan(&contentID, &eventType, &sessionID, &actorID, &orderID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !discoveryEventFactsMatch(input, contentID, eventType, sessionID, actorID, orderID) {
		return true, ErrDiscoveryContentEventConflict
	}
	return true, nil
}

func RecordDiscoveryContentEvent(ctx context.Context, db *sql.DB, input DiscoveryContentEventInput) error {
	input.ID = strings.TrimSpace(input.ID)
	input.ClientEventID = strings.TrimSpace(input.ClientEventID)
	input.ContentID = strings.TrimSpace(input.ContentID)
	input.EventType = strings.ToUpper(strings.TrimSpace(input.EventType))
	input.ClientSessionID = strings.TrimSpace(input.ClientSessionID)
	input.ClientActorID = strings.TrimSpace(input.ClientActorID)
	input.OrderID = strings.TrimSpace(input.OrderID)
	if db == nil || input.ID == "" || input.ClientEventID == "" || len(input.ClientEventID) > 128 || input.ContentID == "" || input.EventType == "" || input.ClientSessionID == "" || len(input.ClientSessionID) > 128 {
		return ErrDiscoveryContentEventInvalid
	}
	if input.EventType != "IMPRESSION" && input.EventType != "CLICK" && input.EventType != "CONVERSION" {
		return ErrDiscoveryContentEventInvalid
	}
	if input.EventType == "CONVERSION" {
		if input.ClientActorID == "" || input.OrderID == "" {
			return ErrDiscoveryContentEventInvalid
		}
	} else if input.ClientActorID != "" || input.OrderID != "" {
		return ErrDiscoveryContentEventInvalid
	}
	var eligible bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM dsh.discovery_content
		WHERE id=$1 AND state='PUBLISHED' AND starts_at <= clock_timestamp() AND (ends_at IS NULL OR ends_at > clock_timestamp())
	)`, input.ContentID).Scan(&eligible); err != nil {
		return err
	}
	if !eligible {
		// An already-recorded event remains replayable after a campaign
		// expires; a new event for that content must still be rejected.
		found, err := readDiscoveryContentEventReplay(ctx, db, input)
		if err != nil {
			return err
		}
		if found {
			return nil
		}
		return ErrDiscoveryContentEventNotFound
	}
	if input.EventType == "CONVERSION" {
		// Conversion means an order created after a recorded click, attributed
		// to the same content and session within the last 24 hours. Knowing an
		// order ID alone is not evidence that marketing led to that order.
		if err := db.QueryRowContext(ctx, `SELECT EXISTS (
			SELECT 1 FROM dsh.commerce_orders orders
			JOIN dsh.discovery_content_events click ON click.content_id=$1
			WHERE orders.id=$2 AND orders.client_actor_id=$3
			  AND click.event_type='CLICK' AND click.client_session_id=$4
			  AND click.occurred_at<=orders.created_at
			  AND click.occurred_at>=orders.created_at-interval '24 hours'
		)`, input.ContentID, input.OrderID, input.ClientActorID, input.ClientSessionID).Scan(&eligible); err != nil {
			return err
		}
		if !eligible {
			// An exact, already-attributed event remains idempotently replayable
			// after its original click has aged out of the 24-hour window.
			found, err := readDiscoveryContentEventReplay(ctx, db, input)
			if err != nil {
				return err
			}
			if found {
				return nil
			}
			return ErrDiscoveryContentEventInvalid
		}
	}
	result, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_events(id,client_event_id,content_id,event_type,client_session_id,client_actor_id,order_id)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,'')) ON CONFLICT (client_event_id) DO NOTHING`, input.ID, input.ClientEventID, input.ContentID, input.EventType, input.ClientSessionID, input.ClientActorID, input.OrderID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 1 {
		return nil
	}
	// PostgreSQL waits for the competing unique-key insert to settle before
	// returning zero rows. Confirm it was an exact replay, not another
	// content/session/order silently lost under the same client event ID.
	found, err := readDiscoveryContentEventReplay(ctx, db, input)
	if err != nil {
		return err
	}
	if !found {
		return ErrDiscoveryContentEventConflict
	}
	return nil
}

func ListDiscoveryContentAnalytics(ctx context.Context, db *sql.DB, contentID string) ([]DiscoveryContentAnalyticsRecord, error) {
	contentID = strings.TrimSpace(contentID)
	if db == nil || contentID == "" || len(contentID) > 128 {
		return nil, ErrDiscoveryContentInvalid
	}
	rows, err := db.QueryContext(ctx, "SELECT content_id,event_type,COUNT(*) FROM dsh.discovery_content_events WHERE content_id=$1 GROUP BY content_id,event_type ORDER BY event_type", contentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]DiscoveryContentAnalyticsRecord, 0)
	for rows.Next() {
		var item DiscoveryContentAnalyticsRecord
		if err := rows.Scan(&item.ContentID, &item.EventType, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
