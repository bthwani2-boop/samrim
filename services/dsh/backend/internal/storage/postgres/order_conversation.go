package postgres

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrOrderConversationNotFound        = errors.New("order conversation was not found")
	ErrOrderConversationForbidden       = errors.New("order conversation is not visible to this actor")
	ErrOrderConversationMessageNotFound = errors.New("order conversation message was not found")
	ErrOrderConversationInvalid         = errors.New("order conversation input is invalid")
	ErrOrderConversationIdempotency     = errors.New("order conversation idempotency key was already used with different facts")
	ErrOrderConversationReadOnly        = errors.New("order conversation is read-only")
)

type OrderConversationMessageRecord struct {
	ID               string
	OrderID          string
	SenderActorID    string
	SenderRole       string
	MediaKind        string
	MediaContentType string
	RecipientRoles   []string
	Body             string
	CreatedAt        time.Time
	ReadAt           *time.Time
	Mine             bool
}

type OrderConversationRecord struct {
	OrderID     string
	OrderState  string
	ReadOnlyAt  *time.Time
	CanSend     bool
	Messages    []OrderConversationMessageRecord
	UnreadCount int
	NextCursor  string
}

type orderConversationOrder struct {
	StoreID            string
	ClientActorID      string
	PartnerActorID     string
	State              string
	UpdatedAt          time.Time
	CaptainParticipant bool
	CaptainJoinedAt    time.Time
}

type OrderConversationMedia struct {
	Kind        string
	ContentType string
	Bytes       []byte
}

func ValidateOrderConversationMedia(media OrderConversationMedia) error {
	n := len(media.Bytes)
	if media.Kind == "image" {
		if n < 1 || n > 3*1024*1024 {
			return ErrOrderConversationInvalid
		}
		detected := http.DetectContentType(media.Bytes)
		if media.ContentType == "image/jpeg" && detected == "image/jpeg" ||
			media.ContentType == "image/png" && detected == "image/png" ||
			media.ContentType == "image/webp" && detected == "image/webp" {
			return nil
		}
	}
	if media.Kind == "audio" {
		if n < 12 || n > 1536*1024 {
			return ErrOrderConversationInvalid
		}
		mp4 := n >= 12 && string(media.Bytes[4:8]) == "ftyp"
		webm := bytes.HasPrefix(media.Bytes, []byte{0x1a, 0x45, 0xdf, 0xa3})
		aac := n >= 2 && media.Bytes[0] == 0xff && media.Bytes[1]&0xf0 == 0xf0
		if (media.ContentType == "audio/mp4" || media.ContentType == "audio/m4a" || media.ContentType == "audio/3gpp") && mp4 ||
			media.ContentType == "audio/webm" && webm || media.ContentType == "audio/aac" && aac {
			return nil
		}
	}
	if media.Kind == "video" {
		if n < 12 || n > 6*1024*1024 {
			return ErrOrderConversationInvalid
		}
		mp4 := string(media.Bytes[4:8]) == "ftyp"
		webm := bytes.HasPrefix(media.Bytes, []byte{0x1a, 0x45, 0xdf, 0xa3})
		if media.ContentType == "video/mp4" && mp4 || media.ContentType == "video/webm" && webm {
			return nil
		}
	}
	return ErrOrderConversationInvalid
}
func HashOrderConversationMediaRequest(orderID, body string, recipients []string, media OrderConversationMedia) string {
	digest := sha256.Sum256(media.Bytes)
	facts := append(append([]string(nil), recipients...), "media:"+media.Kind+":"+media.ContentType+":"+hex.EncodeToString(digest[:]))
	return HashOrderConversationMessageRequest(orderID, body, facts...)
}
func HashOrderConversationMessageRequest(orderID, body string, recipients ...string) string {
	facts := []string{strings.TrimSpace(orderID), strings.TrimSpace(body)}
	if len(recipients) > 0 {
		roles := append([]string(nil), recipients...)
		sort.Strings(roles)
		facts = append(facts, strings.Join(roles, ","))
	}
	hash := sha256.Sum256([]byte(strings.Join(facts, "\x00")))
	return hex.EncodeToString(hash[:])
}

func normalizeConversationRecipients(roles []string) ([]string, error) {
	if len(roles) == 0 {
		return []string{"client", "partner", "captain"}, nil
	}
	if len(roles) > 4 {
		return nil, ErrOrderConversationInvalid
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(roles))
	for _, r := range roles {
		if !validConversationRole(r) || seen[r] {
			return nil, ErrOrderConversationInvalid
		}
		seen[r] = true
		out = append(out, r)
	}
	sort.Strings(out)
	return out, nil
}

func hasConversationRecipient(roles []string, target string) bool {
	for _, r := range roles {
		if r == target {
			return true
		}
	}
	return false
}

func ReadOrderConversation(ctx context.Context, db *sql.DB, orderID, actorID, role string, limit int, before ...string) (OrderConversationRecord, error) {
	orderID = strings.TrimSpace(orderID)
	actorID = strings.TrimSpace(actorID)
	role = strings.TrimSpace(role)
	if db == nil || orderID == "" || actorID == "" || !validConversationRole(role) || limit < 1 || limit > 100 {
		return OrderConversationRecord{}, ErrOrderConversationInvalid
	}
	order, err := readOrderConversationOrder(ctx, db, orderID, actorID, role, false)
	if err != nil {
		return OrderConversationRecord{}, err
	}
	cursor := ""
	if len(before) > 0 {
		cursor = strings.TrimSpace(before[0])
	}
	if len(cursor) > 128 {
		return OrderConversationRecord{}, ErrOrderConversationInvalid
	}
	result := conversationResult(orderID, order, time.Now())
	var joinedAt any
	if role == "captain" {
		joinedAt = order.CaptainJoinedAt
	}
	rows, err := db.QueryContext(ctx, `SELECT m.id,m.order_id,m.sender_actor_id,m.sender_role,m.body,m.created_at,array_to_string(m.recipient_roles,','),m.media_kind,m.media_content_type,
		COALESCE(read_state.read_at, CASE WHEN m.sender_actor_id=$2 THEN m.created_at END) AS read_at
		FROM (
			SELECT id,order_id,sender_actor_id,sender_role,body,created_at,recipient_roles,media_kind,media_content_type
			FROM dsh.commerce_order_conversation_messages
			WHERE order_id=$1 AND (sender_actor_id=$2 OR $4=ANY(recipient_roles))
			AND ($4<>'captain' OR created_at >= $5)
			AND ($6='' OR (created_at,id) < (SELECT marker.created_at,marker.id FROM dsh.commerce_order_conversation_messages marker
				WHERE marker.id=$6 AND marker.order_id=$1
				AND (marker.sender_actor_id=$2 OR $4=ANY(marker.recipient_roles))
				AND ($4<>'captain' OR marker.created_at >= $5)))
			ORDER BY created_at DESC,id DESC
			LIMIT $3 + 1
		) m
		LEFT JOIN dsh.commerce_order_conversation_read_state read_state
		  ON read_state.actor_id=$2 AND read_state.message_id=m.id
		ORDER BY m.created_at,m.id`, orderID, actorID, limit, role, joinedAt, cursor)
	if err != nil {
		return OrderConversationRecord{}, err
	}
	defer rows.Close()
	result.Messages = make([]OrderConversationMessageRecord, 0, limit)
	for rows.Next() {
		var item OrderConversationMessageRecord
		var readAt sql.NullTime
		var audience string
		var kind, mime sql.NullString
		if err := rows.Scan(&item.ID, &item.OrderID, &item.SenderActorID, &item.SenderRole, &item.Body, &item.CreatedAt, &audience, &kind, &mime, &readAt); err != nil {
			return OrderConversationRecord{}, err
		}
		item.RecipientRoles = strings.Split(audience, ",")
		item.MediaKind = kind.String
		item.MediaContentType = mime.String
		item.Mine = item.SenderActorID == actorID
		if readAt.Valid {
			item.ReadAt = &readAt.Time
		}
		result.Messages = append(result.Messages, item)
	}
	if err := rows.Err(); err != nil {
		return OrderConversationRecord{}, err
	}
	if len(result.Messages) > limit {
		result.Messages = result.Messages[1:]
		result.NextCursor = result.Messages[0].ID
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*)
		FROM dsh.commerce_order_conversation_messages m
		LEFT JOIN dsh.commerce_order_conversation_read_state read_state
		  ON read_state.actor_id=$2 AND read_state.message_id=m.id
		WHERE m.order_id=$1 AND m.sender_actor_id<>$2 AND read_state.message_id IS NULL
		AND ($3=ANY(m.recipient_roles))
		AND ($3<>'captain' OR m.created_at >= $4)`, orderID, actorID, role, joinedAt).Scan(&result.UnreadCount); err != nil {
		return OrderConversationRecord{}, err
	}
	return result, nil
}

func SendOrderConversationMessage(ctx context.Context, db *sql.DB, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID string, recipientRoles ...string) (OrderConversationMessageRecord, bool, error) {
	return sendOrderConversationCore(ctx, db, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID, recipientRoles, nil)
}
func SendOrderConversationMedia(ctx context.Context, db *sql.DB, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID string, recipientRoles []string, attachment OrderConversationMedia) (OrderConversationMessageRecord, bool, error) {
	if err := ValidateOrderConversationMedia(attachment); err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	return sendOrderConversationCore(ctx, db, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID, recipientRoles, &attachment)
}
func sendOrderConversationCore(ctx context.Context, db *sql.DB, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID string, recipientRoles []string, attachment *OrderConversationMedia) (result OrderConversationMessageRecord, replayed bool, returnErr error) {
	orderID = strings.TrimSpace(orderID)
	actorID = strings.TrimSpace(actorID)
	role = strings.TrimSpace(role)
	body = strings.TrimSpace(body)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || orderID == "" || actorID == "" || !validConversationRole(role) || !utf8.ValidString(body) || utf8.RuneCountInString(body) < 1 || utf8.RuneCountInString(body) > 2000 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || requestHash == "" || correlationID == "" {
		return OrderConversationMessageRecord{}, false, ErrOrderConversationInvalid
	}
	recipients, err := normalizeConversationRecipients(recipientRoles)
	if err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:order-conversation-message:"+idempotencyKey); err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	var storedHash, storedOrderID, storedActorID, storedRole string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,order_id,sender_actor_id,sender_role
		FROM dsh.commerce_order_conversation_messages WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedOrderID, &storedActorID, &storedRole)
	if err == nil {
		if storedHash != requestHash || storedOrderID != orderID || storedActorID != actorID || storedRole != role {
			return OrderConversationMessageRecord{}, false, ErrOrderConversationIdempotency
		}
		if _, err := readOrderConversationOrder(ctx, tx, orderID, actorID, role, false); err != nil {
			return OrderConversationMessageRecord{}, false, err
		}
		result, err = readOrderConversationMessage(ctx, tx, "idempotency_key=$1", idempotencyKey)
		if err != nil {
			return OrderConversationMessageRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return OrderConversationMessageRecord{}, false, err
		}
		result.Mine = true
		return result, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderConversationMessageRecord{}, false, err
	}
	order, err := readOrderConversationOrder(ctx, tx, orderID, actorID, role, true)
	if err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	now := time.Now()
	if order.ReadOnlyAt() != nil {
		return OrderConversationMessageRecord{}, false, ErrOrderConversationReadOnly
	}
	if hasConversationRecipient(recipients, "captain") && len(recipientRoles) > 0 {
		var assigned bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE order_id=$1 AND state IN ('assigned','in_custody','delivery_failed'))", orderID).Scan(&assigned); err != nil {
			return OrderConversationMessageRecord{}, false, err
		}
		if !assigned {
			return OrderConversationMessageRecord{}, false, ErrOrderConversationInvalid
		}
	}
	messageID, err := newID("message")
	if err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	var kind, contentType any
	var data []byte
	if attachment != nil {
		kind = attachment.Kind
		contentType = attachment.ContentType
		data = attachment.Bytes
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_conversation_messages(id,order_id,sender_actor_id,sender_role,body,idempotency_key,request_hash,correlation_id,recipient_roles,media_kind,media_content_type,media_data)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12)`, messageID, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID, "{"+strings.Join(recipients, ",")+"}", kind, contentType, data); err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	result = OrderConversationMessageRecord{ID: messageID, OrderID: orderID, SenderActorID: actorID, SenderRole: role, Body: body, CreatedAt: now, Mine: true, ReadAt: &now, RecipientRoles: recipients}
	if attachment != nil {
		result.MediaKind = attachment.Kind
		result.MediaContentType = attachment.ContentType
	}
	if err := tx.Commit(); err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	return result, false, nil
}

func ReadOrderConversationMedia(ctx context.Context, db *sql.DB, orderID, actorID, role, messageID string) (OrderConversationMedia, error) {
	if db == nil || orderID == "" || actorID == "" || messageID == "" || !validConversationRole(role) {
		return OrderConversationMedia{}, ErrOrderConversationInvalid
	}
	order, err := readOrderConversationOrder(ctx, db, orderID, actorID, role, false)
	if err != nil {
		return OrderConversationMedia{}, err
	}
	var joinedAt any
	if role == "captain" {
		joinedAt = order.CaptainJoinedAt
	}
	var media OrderConversationMedia
	err = db.QueryRowContext(ctx, `SELECT media_kind,media_content_type,media_data FROM dsh.commerce_order_conversation_messages
  WHERE id=$1 AND order_id=$2 AND media_kind IS NOT NULL
  AND (sender_actor_id=$3 OR $4=ANY(recipient_roles))
  AND ($4<>'captain' OR created_at >= $5)`, messageID, orderID, actorID, role, joinedAt).
		Scan(&media.Kind, &media.ContentType, &media.Bytes)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderConversationMedia{}, ErrOrderConversationMessageNotFound
	}
	if err != nil {
		return OrderConversationMedia{}, err
	}
	return media, nil
}

func MarkOrderConversationRead(ctx context.Context, db *sql.DB, orderID, actorID, role, messageID string) (time.Time, error) {
	orderID = strings.TrimSpace(orderID)
	actorID = strings.TrimSpace(actorID)
	role = strings.TrimSpace(role)
	messageID = strings.TrimSpace(messageID)
	if db == nil || orderID == "" || actorID == "" || !validConversationRole(role) || messageID == "" {
		return time.Time{}, ErrOrderConversationInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return time.Time{}, err
	}
	defer func() { _ = tx.Rollback() }()
	order, err := readOrderConversationOrder(ctx, tx, orderID, actorID, role, true)
	if err != nil {
		return time.Time{}, err
	}
	var joinedAt any
	if role == "captain" {
		joinedAt = order.CaptainJoinedAt
	}
	var targetCreatedAt time.Time
	if err := tx.QueryRowContext(ctx, `SELECT created_at FROM dsh.commerce_order_conversation_messages WHERE id=$1 AND order_id=$2
		AND (sender_actor_id=$3 OR $4=ANY(recipient_roles))
		AND ($4<>'captain' OR created_at >= $5)`, messageID, orderID, actorID, role, joinedAt).Scan(&targetCreatedAt); errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrOrderConversationMessageNotFound
	} else if err != nil {
		return time.Time{}, err
	}
	var readAt time.Time
	if err := tx.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&readAt); err != nil {
		return time.Time{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_conversation_read_state(actor_id,message_id,read_at)
		SELECT $1,m.id,$3 FROM dsh.commerce_order_conversation_messages m
		WHERE m.order_id=$2 AND (m.created_at,m.id) <= ($4,$5)
		AND (m.sender_actor_id=$1 OR $6=ANY(m.recipient_roles))
		AND ($6<>'captain' OR m.created_at >= $7)
		ON CONFLICT (actor_id,message_id) DO NOTHING`, actorID, orderID, readAt, targetCreatedAt, messageID, role, joinedAt); err != nil {
		return time.Time{}, err
	}
	// A retry must return the original read receipt, not manufacture a new read time.
	if err := tx.QueryRowContext(ctx, `SELECT read_at FROM dsh.commerce_order_conversation_read_state
		WHERE actor_id=$1 AND message_id=$2`, actorID, messageID).Scan(&readAt); err != nil {
		return time.Time{}, err
	}
	if err := tx.Commit(); err != nil {
		return time.Time{}, err
	}
	return readAt, nil
}

func readOrderConversationMessage(ctx context.Context, source rowQueryer, where string, args ...any) (OrderConversationMessageRecord, error) {
	var item OrderConversationMessageRecord
	var readAt sql.NullTime
	var audience string
	var kind, mime sql.NullString
	err := source.QueryRowContext(ctx, "SELECT id,order_id,sender_actor_id,sender_role,body,created_at,NULL::timestamptz,array_to_string(recipient_roles,','),media_kind,media_content_type FROM dsh.commerce_order_conversation_messages WHERE "+where, args...).Scan(&item.ID, &item.OrderID, &item.SenderActorID, &item.SenderRole, &item.Body, &item.CreatedAt, &readAt, &audience, &kind, &mime)
	item.MediaKind = kind.String
	item.MediaContentType = mime.String
	item.RecipientRoles = strings.Split(audience, ",")
	if errors.Is(err, sql.ErrNoRows) {
		return OrderConversationMessageRecord{}, ErrOrderConversationMessageNotFound
	}
	if err != nil {
		return OrderConversationMessageRecord{}, err
	}
	return item, nil
}

func readOrderConversationOrder(ctx context.Context, source rowQueryer, orderID, actorID, role string, lock bool) (orderConversationOrder, error) {
	lockClause := ""
	if lock {
		lockClause = " FOR UPDATE"
	}
	var order orderConversationOrder
	err := source.QueryRowContext(ctx, `SELECT o.store_id,o.client_actor_id,s.partner_actor_id,o.state,
		COALESCE((SELECT audit.created_at FROM dsh.commerce_order_audit audit WHERE audit.order_id=o.id AND audit.to_state=o.state ORDER BY audit.created_at DESC LIMIT 1),o.updated_at)
		FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE o.id=$1`+lockClause, orderID).Scan(&order.StoreID, &order.ClientActorID, &order.PartnerActorID, &order.State, &order.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return orderConversationOrder{}, ErrOrderConversationNotFound
	}
	if err != nil {
		return orderConversationOrder{}, err
	}
	if role == "client" && order.ClientActorID != actorID {
		return orderConversationOrder{}, ErrOrderConversationForbidden
	}
	if role == "partner" && order.PartnerActorID != actorID {
		// The Orders grant also authorizes delegated Partner staff to
		// manage the Order. Keep its conversation under the same current
		// active Store grant, not a separate owner-only permission model.
		var allowed bool
		if err := source.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.store_access_grants
			WHERE store_id=$1 AND delegate_actor_id=$2 AND state='active' AND 'orders'=ANY(permissions))`, order.StoreID, actorID).Scan(&allowed); err != nil {
			return orderConversationOrder{}, err
		}
		if !allowed {
			return orderConversationOrder{}, ErrOrderConversationForbidden
		}
	}
	if role == "captain" {
		// Once operational delivery ends, chat and location are no longer
		// part of the Captain's working view; Client/Partner dispute records
		// remain available through their existing authorized routes.
		if order.State == "DELIVERED" || order.State == "PICKED_UP" || order.State == "REJECTED" || order.State == "CANCELLED" {
			return orderConversationOrder{}, ErrOrderConversationForbidden
		}
		if err := source.QueryRowContext(ctx, `SELECT created_at FROM dsh.captain_assignments
			WHERE order_id=$1 AND captain_actor_id=$2 AND state IN ('assigned','in_custody','delivery_failed')
			ORDER BY created_at DESC LIMIT 1`, orderID, actorID).Scan(&order.CaptainJoinedAt); errors.Is(err, sql.ErrNoRows) {
			return orderConversationOrder{}, ErrOrderConversationForbidden
		} else if err != nil {
			return orderConversationOrder{}, err
		}
		order.CaptainParticipant = true
	}
	return order, nil
}

func (order orderConversationOrder) ReadOnlyAt() *time.Time {
	if order.State != "DELIVERED" && order.State != "PICKED_UP" && order.State != "REJECTED" && order.State != "CANCELLED" {
		return nil
	}
	value := order.UpdatedAt
	return &value
}

func conversationResult(orderID string, order orderConversationOrder, _ time.Time) OrderConversationRecord {
	readOnlyAt := order.ReadOnlyAt()
	canSend := readOnlyAt == nil
	return OrderConversationRecord{OrderID: orderID, OrderState: order.State, ReadOnlyAt: readOnlyAt, CanSend: canSend}
}

func validConversationRole(role string) bool {
	return role == "client" || role == "partner" || role == "captain" || role == "operator"
}
