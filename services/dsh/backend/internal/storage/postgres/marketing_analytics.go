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
		SELECT 1 FROM dsh.discovery_content content
		WHERE content.id=$1 AND content.state='PUBLISHED' AND content.starts_at <= clock_timestamp()
		  AND NOT EXISTS (SELECT 1 FROM dsh.marketing_campaign_content_links link
			JOIN dsh.marketing_campaigns campaign ON campaign.id=link.campaign_id
			WHERE link.content_id=content.id AND campaign.state<>'PUBLISHED')
		  AND (content.ends_at IS NULL OR content.ends_at > clock_timestamp())
		  AND EXISTS (
			SELECT 1 FROM dsh.discovery_content_media_assets asset
			WHERE asset.id=content.media_asset_id AND asset.state='active'
			  AND asset.rights_attested_at IS NOT NULL AND asset.uri<>''
		  )
	)`, input.ContentID).Scan(&eligible); err != nil {
		return err
	}
	if !eligible && input.EventType != "CONVERSION" {
		// New clicks/impressions require active, licensed content, but exact
		// prior events remain replayable after expiry or media retirement.
		// Conversion is instead attributed to a click at the order creation
		// time, so expiry after a legitimate click does not erase that sale.
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
		// to the latest clicked content in the same session within 24 hours.
		// Knowing an order ID or an older click alone is not attribution.
		if err := db.QueryRowContext(ctx, `SELECT EXISTS (
			SELECT 1 FROM dsh.commerce_orders orders
			JOIN LATERAL (
				SELECT click.content_id
				FROM dsh.discovery_content_events click
				WHERE click.event_type='CLICK' AND click.client_session_id=$4
				  AND click.occurred_at<=orders.created_at
				  AND click.occurred_at>=orders.created_at-interval '24 hours'
				ORDER BY click.occurred_at DESC,click.id DESC
				LIMIT 1
			) latest_click ON latest_click.content_id=$1
			WHERE orders.id=$2 AND orders.client_actor_id=$3
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
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,'')) ON CONFLICT DO NOTHING`, input.ID, input.ClientEventID, input.ContentID, input.EventType, input.ClientSessionID, input.ClientActorID, input.OrderID)
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

// RecordCheckoutDiscoveryConversionTx attributes a committed Order using a
// previously acknowledged click event ID. No mobile CONVERSION event is needed.
func RecordCheckoutDiscoveryConversionTx(ctx context.Context, tx *sql.Tx, orderID, actorID, clickEventID string) error {
	clickEventID = strings.TrimSpace(clickEventID)
	if clickEventID == "" || len(clickEventID) > 128 {
		return nil
	}
	eventID := "checkout-conversion-" + hashFacts(orderID)[:32]
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.discovery_content_events (
		id,client_event_id,content_id,event_type,client_session_id,client_actor_id,order_id
	)
	SELECT $1,$1,click.content_id,'CONVERSION',click.client_session_id,$2,orders.id
	FROM dsh.commerce_orders orders
	JOIN dsh.discovery_content_events click ON click.client_event_id=$3 AND click.event_type='CLICK'
	WHERE orders.id=$4 AND orders.client_actor_id=$2
	  AND (click.client_actor_id IS NULL OR click.client_actor_id=$2)
	  AND click.occurred_at<=orders.created_at
	  AND click.occurred_at>=orders.created_at-interval '24 hours'
	  AND click.id=(
		SELECT latest.id FROM dsh.discovery_content_events latest
		WHERE latest.event_type='CLICK' AND latest.client_session_id=click.client_session_id
		  AND latest.occurred_at<=orders.created_at
		  AND latest.occurred_at>=orders.created_at-interval '24 hours'
		ORDER BY latest.occurred_at DESC,latest.id DESC LIMIT 1
	  )
	ON CONFLICT DO NOTHING`, eventID, actorID, clickEventID, orderID)
	return err
}

// ListPartnerStoreContentAnalytics never exposes the existence or results of content
// that was not submitted by the authorized Store. The caller must first perform
// Store-scoped session/permission authorization in the DSH HTTP owner.
func ListPartnerStoreContentAnalytics(ctx context.Context, db *sql.DB, storeID, contentID string) ([]DiscoveryContentAnalyticsRecord, bool, error) {
	storeID = strings.TrimSpace(storeID)
	contentID = strings.TrimSpace(contentID)
	if db == nil || storeID == "" || contentID == "" || len(storeID) > 150 || len(contentID) > 128 {
		return nil, false, ErrDiscoveryContentInvalid
	}
	// Bind ownership and aggregation in one PostgreSQL statement/snapshot.
	// One LEFT JOIN row proves ownership even when the content has no events.
	rows, err := db.QueryContext(ctx, `SELECT content.id, events.event_type, COUNT(events.id)
		FROM dsh.discovery_content content
		LEFT JOIN dsh.discovery_content_events events ON events.content_id=content.id
		WHERE content.id=$1 AND content.source_store_id=$2 AND content.kind='SHORT_FORM'
		GROUP BY content.id, events.event_type
		ORDER BY events.event_type`, contentID, storeID)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	items := make([]DiscoveryContentAnalyticsRecord, 0)
	belongs := false
	for rows.Next() {
		var id string
		var eventType sql.NullString
		var count int64
		if err := rows.Scan(&id, &eventType, &count); err != nil {
			return nil, false, err
		}
		belongs = true
		if eventType.Valid {
			items = append(items, DiscoveryContentAnalyticsRecord{ContentID: id, EventType: eventType.String, Count: count})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	return items, belongs, nil
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

// StoreContentPerformanceSummary is a Store-scoped projection of its own short-form
// discovery media events. CONVERSION means an attributed created Order, not
// a completed or paid Order and never a WLT settlement.
type StoreContentPerformanceSummary struct {
	StoreID                 string
	ContentCount            int64
	Impressions             int64
	Clicks                  int64
	AttributedOrdersCreated int64
}

func ReadStoreContentPerformanceSummary(ctx context.Context, db *sql.DB, storeID string) (StoreContentPerformanceSummary, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || storeID == "" || len(storeID) > 150 {
		return StoreContentPerformanceSummary{}, ErrDiscoveryContentInvalid
	}
	summary := StoreContentPerformanceSummary{StoreID: storeID}
	err := db.QueryRowContext(ctx, `SELECT COUNT(DISTINCT content.id)::bigint,
		COUNT(events.id) FILTER (WHERE events.event_type='IMPRESSION'),
		COUNT(events.id) FILTER (WHERE events.event_type='CLICK'),
		COUNT(events.id) FILTER (WHERE events.event_type='CONVERSION')
		FROM dsh.discovery_content content
		LEFT JOIN dsh.discovery_content_events events ON events.content_id=content.id
		WHERE content.source_store_id=$1 AND content.kind='SHORT_FORM'`, storeID).Scan(
		&summary.ContentCount, &summary.Impressions, &summary.Clicks, &summary.AttributedOrdersCreated)
	if err != nil {
		return StoreContentPerformanceSummary{}, err
	}
	return summary, nil
}
