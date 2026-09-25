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
		return ErrDiscoveryContentEventNotFound
	}
	if input.EventType == "CONVERSION" {
		if err := db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.commerce_orders WHERE id=$1 AND client_actor_id=$2)", input.OrderID, input.ClientActorID).Scan(&eligible); err != nil {
			return err
		}
		if !eligible {
			return ErrDiscoveryContentEventInvalid
		}
	}
	_, err := db.ExecContext(ctx, `INSERT INTO dsh.discovery_content_events(id,client_event_id,content_id,event_type,client_session_id,client_actor_id,order_id)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,'')) ON CONFLICT (client_event_id) DO NOTHING`, input.ID, input.ClientEventID, input.ContentID, input.EventType, input.ClientSessionID, input.ClientActorID, input.OrderID)
	return err
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
