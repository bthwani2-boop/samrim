package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const expoPushEndpoint = "https://exp.host/--/api/v2/push/send"
const expoReceiptEndpoint = "https://exp.host/--/api/v2/push/getReceipts"

var expoTokenRE = regexp.MustCompile(`^Expo(nent)?PushToken\[[A-Za-z0-9_-]{16,220}\]$`)
var installationIDRE = regexp.MustCompile(`^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)
var ErrPushRegistration = errors.New("invalid push device registration")
var ErrPushRole = errors.New("push notifications require an active customer, partner or captain session")

type PushDeviceInput struct {
	InstallationID string `json:"installationId"`
	ExpoPushToken  string `json:"expoPushToken"`
	Tone           string `json:"tone"`
}

func validPushDevice(in PushDeviceInput) bool {
	return installationIDRE.MatchString(in.InstallationID) && expoTokenRE.MatchString(in.ExpoPushToken) &&
		(in.Tone == "classic" || in.Tone == "soft" || in.Tone == "urgent")
}

func (s *Service) RegisterPushDevice(ctx context.Context, bearer string, input PushDeviceInput) error {
	actor, role, err := s.requireSession(ctx, bearer)
	if err != nil {
		return err
	}
	if role != "client" && role != "partner" && role != "captain" {
		return ErrPushRole
	}
	if !validPushDevice(input) {
		return ErrPushRegistration
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO dsh.notification_push_devices AS existing
        (installation_id,actor_id,actor_role,expo_push_token,tone)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (installation_id) DO UPDATE
        SET actor_id=excluded.actor_id,actor_role=excluded.actor_role,
            expo_push_token=excluded.expo_push_token,tone=excluded.tone,
            enabled=true,updated_at=clock_timestamp(),
            registered_at=CASE WHEN existing.actor_id<>excluded.actor_id OR existing.actor_role<>excluded.actor_role
                THEN clock_timestamp() ELSE existing.registered_at END`,
		input.InstallationID, actor.Subject, role, input.ExpoPushToken, input.Tone)
	return err
}

func (s *Service) UnregisterPushDevice(ctx context.Context, bearer, installationID string) error {
	actor, role, err := s.requireSession(ctx, bearer)
	if err != nil {
		return err
	}
	if role != "client" && role != "partner" && role != "captain" {
		return ErrPushRole
	}
	if !installationIDRE.MatchString(installationID) {
		return ErrPushRegistration
	}
	_, err = s.db.ExecContext(ctx, `UPDATE dsh.notification_push_devices
        SET enabled=false, updated_at=clock_timestamp()
        WHERE installation_id=$1 AND actor_id=$2 AND actor_role=$3`,
		installationID, actor.Subject, role)
	return err
}

// Push delivery deliberately uses generic text; the protected inbox is the
// authority for order details, avoiding private data leaks from OS lock screens.
type pushItem struct {
	ID             int64
	InstallationID string
	Token          string
	ActorID        string
	Tone           string
	NotificationID string
	OrderID        string
	Kind           string
}
type expoTicket struct {
	Status  string `json:"status"`
	ID      string `json:"id"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

// Accept either the object form or a one-element array returned by Expo.
func parseExpoTicket(raw []byte) (expoTicket, error) {
	var result struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || len(result.Data) == 0 {
		return expoTicket{}, errors.New("invalid Expo push response")
	}
	if result.Data[0] == '[' {
		var tickets []expoTicket
		if err := json.Unmarshal(result.Data, &tickets); err != nil || len(tickets) != 1 {
			return expoTicket{}, errors.New("invalid Expo push ticket batch")
		}
		return tickets[0], nil
	}
	var ticket expoTicket
	err := json.Unmarshal(result.Data, &ticket)
	return ticket, err
}

func pushCopy(kind string) (string, string) {
	switch kind {
	case "ORDER_CREATED":
		return "طلب جديد", "لديك طلب يحتاج إلى قبول"
	case "CAPTAIN_OFFER":
		return "عرض توصيل جديد", "لديك عرض توصيل يحتاج إلى رد"
	case "CAPTAIN_ARRIVED":
		return "وصل الكابتن", "الكابتن عند موقع التسليم"
	default:
		return "تنبيه بثواني", "يوجد تحديث يحتاج انتباهك"
	}
}

// Seed only still-actionable events that happened after the device was bound.
// Audit rows and one-time arrivals are canonical; no fake notification records.
func (s *Service) enqueuePush(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO dsh.notification_push_outbox
      (installation_id,notification_id,actor_id,actor_role,order_id,kind)
    SELECT devices.installation_id, events.notification_id,devices.actor_id,devices.actor_role,events.order_id,events.kind
    FROM (
      SELECT 'order:' || audit.id AS notification_id, audit.order_id, 'ORDER_CREATED'::text AS kind,
        stores.partner_actor_id AS actor_id, 'partner'::text AS role, audit.created_at AS occurred_at
      FROM dsh.commerce_order_audit audit
      JOIN dsh.commerce_orders orders ON orders.id=audit.order_id
      JOIN dsh.stores stores ON stores.id=orders.store_id
      WHERE audit.event_type='order_created' AND orders.state='CREATED'
        AND audit.created_at > clock_timestamp()-interval '24 hours'
      UNION ALL
      SELECT 'captain:' || audit.id, audit.order_id,'CAPTAIN_OFFER',
        audit.captain_actor_id,'captain',audit.created_at
      FROM dsh.captain_audit audit
      JOIN dsh.captain_dispatch_offers offer ON offer.id=audit.offer_id
      WHERE audit.event_type='dispatch_offer_created' AND offer.state='offered'
        AND offer.expires_at>clock_timestamp()
        AND audit.created_at > clock_timestamp()-interval '24 hours'
      UNION ALL
      SELECT 'arrival:' || arrival.id, arrival.order_id,'CAPTAIN_ARRIVED',
        orders.client_actor_id,'client',arrival.arrived_at
      FROM dsh.captain_delivery_arrivals arrival
      JOIN dsh.commerce_orders orders ON orders.id=arrival.order_id
      JOIN dsh.captain_assignments assignment ON assignment.id=arrival.assignment_id
      WHERE assignment.state='in_custody'
        AND arrival.arrived_at > clock_timestamp()-interval '24 hours'
    ) events
    JOIN dsh.notification_push_devices devices
      ON devices.actor_id=events.actor_id AND devices.actor_role=events.role AND devices.enabled
      AND events.occurred_at>=devices.registered_at
    ON CONFLICT (installation_id,notification_id) DO NOTHING`)
	return err
}

func (s *Service) claimPush(ctx context.Context) ([]pushItem, error) {
	rows, err := s.db.QueryContext(ctx, `WITH due AS (
        SELECT id FROM dsh.notification_push_outbox
        WHERE state='pending' AND next_attempt_at<=clock_timestamp()
          AND (locked_until IS NULL OR locked_until<clock_timestamp())
        ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED
    ), claimed AS (
        UPDATE dsh.notification_push_outbox o
        SET locked_until=clock_timestamp()+interval '5 minutes',attempts=o.attempts+1
        FROM due WHERE due.id=o.id
        RETURNING o.id,o.installation_id,o.notification_id,o.order_id,o.kind,o.actor_id,o.actor_role
    )
    SELECT c.id,c.installation_id,COALESCE(devices.expo_push_token,''),
        COALESCE(devices.actor_id,''),COALESCE(devices.tone,'classic'),
        c.notification_id,c.order_id,c.kind
    FROM claimed c LEFT JOIN dsh.notification_push_devices devices
      ON devices.installation_id=c.installation_id AND devices.enabled
      AND devices.actor_id=c.actor_id AND devices.actor_role=c.actor_role
    ORDER BY c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []pushItem{}
	for rows.Next() {
		var item pushItem
		if err = rows.Scan(&item.ID, &item.InstallationID, &item.Token, &item.ActorID,
			&item.Tone, &item.NotificationID, &item.OrderID, &item.Kind); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) pushStillActionable(ctx context.Context, item pushItem) (bool, error) {
	var active bool
	switch item.Kind {
	case "ORDER_CREATED":
		err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.commerce_orders orders
            JOIN dsh.stores stores ON stores.id=orders.store_id
            WHERE orders.id=$1 AND stores.partner_actor_id=$2 AND orders.state='CREATED')`,
			item.OrderID, item.ActorID).Scan(&active)
		return active, err
	case "CAPTAIN_OFFER":
		err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.captain_audit audit
            JOIN dsh.captain_dispatch_offers offer ON offer.id=audit.offer_id
            WHERE 'captain:' || audit.id=$1 AND audit.captain_actor_id=$2
            AND offer.state='offered' AND offer.expires_at>clock_timestamp())`,
			item.NotificationID, item.ActorID).Scan(&active)
		return active, err
	case "CAPTAIN_ARRIVED":
		err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.captain_delivery_arrivals a
            JOIN dsh.commerce_orders orders ON orders.id=a.order_id
            JOIN dsh.captain_assignments assignment ON assignment.id=a.assignment_id
            WHERE 'arrival:' || a.id=$1 AND orders.client_actor_id=$2
              AND assignment.state='in_custody')`,
			item.NotificationID, item.ActorID).Scan(&active)
		return active, err
	}
	return false, nil
}
func (s *Service) finishPush(ctx context.Context, id int64, state, ticket string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE dsh.notification_push_outbox
        SET state=$2,ticket_id=NULLIF($3,''),locked_until=NULL,
          sent_at=CASE WHEN $2='sent' THEN clock_timestamp() ELSE sent_at END,
          next_receipt_at=CASE WHEN $2='sent' THEN clock_timestamp()+interval '15 minutes' ELSE next_receipt_at END
        WHERE id=$1`, id, state, ticket)
	return err
}
func (s *Service) retryPush(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE dsh.notification_push_outbox
        SET locked_until=NULL,
          state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
          next_attempt_at=clock_timestamp()+(LEAST(POWER(2,attempts),60)*interval '15 seconds')
        WHERE id=$1`, id)
	return err
}
func (s *Service) disablePushToken(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE dsh.notification_push_devices SET enabled=false
        WHERE expo_push_token=$1`, token)
	return err
}

// DispatchPushBatch runs only in a server-side worker, gated by an explicit
// environment variable; never sends from tests or mobile apps.
func (s *Service) DispatchPushBatch(ctx context.Context) (int, error) {
	if err := s.enqueuePush(ctx); err != nil {
		return 0, fmt.Errorf("enqueue push: %w", err)
	}
	items, err := s.claimPush(ctx)
	if err != nil {
		return 0, fmt.Errorf("claim push: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	sent := 0
	for _, item := range items {
		if ctx.Err() != nil {
			return sent, ctx.Err()
		}
		if item.Token == "" {
			_ = s.finishPush(ctx, item.ID, "discarded", "")
			continue
		}
		active, checkErr := s.pushStillActionable(ctx, item)
		if checkErr != nil {
			_ = s.retryPush(ctx, item.ID)
			continue
		}
		if !active {
			_ = s.finishPush(ctx, item.ID, "discarded", "")
			continue
		}
		title, body := pushCopy(item.Kind)
		ttl := 180
		if item.Kind == "CAPTAIN_OFFER" {
			ttl = 30
		}
		if item.Kind == "ORDER_CREATED" {
			ttl = 600
		}
		payload := map[string]any{
			"ttl": ttl, "to": item.Token, "title": title, "body": body, "channelId": "order-" + item.Tone + "-v1",
			"priority": "high", "data": map[string]string{
				"orderId": item.OrderID, "notificationId": item.NotificationID, "actorId": item.ActorID,
			},
		}
		encoded, _ := json.Marshal(payload)
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, expoPushEndpoint, bytes.NewReader(encoded))
		if err != nil {
			_ = s.retryPush(ctx, item.ID)
			continue
		}
		request.Header.Set("Content-Type", "application/json")
		if key := strings.TrimSpace(os.Getenv("DSH_EXPO_PUSH_ACCESS_TOKEN")); key != "" {
			request.Header.Set("Authorization", "Bearer "+key)
		}
		response, err := client.Do(request)
		if err != nil {
			_ = s.retryPush(ctx, item.ID)
			continue
		}
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, 16*1024))
		response.Body.Close()
		if readErr != nil || response.StatusCode != http.StatusOK {
			_ = s.retryPush(ctx, item.ID)
			continue
		}
		ticket, parseErr := parseExpoTicket(raw)
		if parseErr != nil {
			_ = s.retryPush(ctx, item.ID)
			continue
		}
		if ticket.Status != "ok" || ticket.ID == "" {
			if ticket.Details.Error == "DeviceNotRegistered" {
				_ = s.disablePushToken(ctx, item.Token)
				_ = s.finishPush(ctx, item.ID, "discarded", "")
			} else {
				_ = s.retryPush(ctx, item.ID)
			}
			continue
		}
		if err = s.finishPush(ctx, item.ID, "sent", ticket.ID); err != nil {
			return sent, fmt.Errorf("record push ticket: %w", err)
		}
		sent++
	}
	if err = s.checkPushReceipts(ctx); err != nil {
		return sent, fmt.Errorf("check push receipts: %w", err)
	}
	return sent, nil
}
