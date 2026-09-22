package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

const orderConversationGracePeriod = time.Hour

var (
	ErrOrderConversationNotFound        = errors.New("order conversation was not found")
	ErrOrderConversationForbidden       = errors.New("order conversation is not visible to this actor")
	ErrOrderConversationMessageNotFound = errors.New("order conversation message was not found")
	ErrOrderConversationInvalid         = errors.New("order conversation input is invalid")
	ErrOrderConversationIdempotency     = errors.New("order conversation idempotency key was already used with different facts")
	ErrOrderConversationReadOnly        = errors.New("order conversation is read-only")
)

type OrderConversationMessageRecord struct {
	ID            string
	OrderID       string
	SenderActorID string
	SenderRole    string
	Body          string
	CreatedAt     time.Time
	ReadAt        *time.Time
	Mine          bool
}

type OrderConversationRecord struct {
	OrderID     string
	OrderState  string
	ReadOnlyAt  *time.Time
	CanSend     bool
	Messages    []OrderConversationMessageRecord
	UnreadCount int
}

type orderConversationOrder struct {
	ClientActorID      string
	PartnerActorID     string
	State              string
	UpdatedAt          time.Time
	CaptainParticipant bool
}

func HashOrderConversationMessageRequest(orderID, body string) string {
	hash := sha256.Sum256([]byte(strings.Join([]string{strings.TrimSpace(orderID), strings.TrimSpace(body)}, "\x00")))
	return hex.EncodeToString(hash[:])
}

func ReadOrderConversation(ctx context.Context, db *sql.DB, orderID, actorID, role string, limit int) (OrderConversationRecord, error) {
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
	result := conversationResult(orderID, order, time.Now())
	rows, err := db.QueryContext(ctx, `SELECT m.id,m.order_id,m.sender_actor_id,m.sender_role,m.body,m.created_at,
		COALESCE(read_state.read_at, CASE WHEN m.sender_actor_id=$2 THEN m.created_at END) AS read_at
		FROM dsh.commerce_order_conversation_messages m
		LEFT JOIN dsh.commerce_order_conversation_read_state read_state
		  ON read_state.actor_id=$2 AND read_state.message_id=m.id
		WHERE m.order_id=$1
		ORDER BY m.created_at,m.id
		LIMIT $3`, orderID, actorID, limit)
	if err != nil {
		return OrderConversationRecord{}, err
	}
	defer rows.Close()
	result.Messages = make([]OrderConversationMessageRecord, 0, limit)
	for rows.Next() {
		var item OrderConversationMessageRecord
		var readAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.OrderID, &item.SenderActorID, &item.SenderRole, &item.Body, &item.CreatedAt, &readAt); err != nil {
			return OrderConversationRecord{}, err
		}
		item.Mine = item.SenderActorID == actorID
		if readAt.Valid {
			item.ReadAt = &readAt.Time
		}
		result.Messages = append(result.Messages, item)
	}
	if err := rows.Err(); err != nil {
		return OrderConversationRecord{}, err
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*)
		FROM dsh.commerce_order_conversation_messages m
		LEFT JOIN dsh.commerce_order_conversation_read_state read_state
		  ON read_state.actor_id=$2 AND read_state.message_id=m.id
		WHERE m.order_id=$1 AND m.sender_actor_id<>$2 AND read_state.message_id IS NULL`, orderID, actorID).Scan(&result.UnreadCount); err != nil {
		return OrderConversationRecord{}, err
	}
	return result, nil
}

func SendOrderConversationMessage(ctx context.Context, db *sql.DB, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID string) (result OrderConversationMessageRecord, replayed bool, returnErr error) {
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
	if order.ReadOnlyAt() != nil && !now.Before(*order.ReadOnlyAt()) {
		return OrderConversationMessageRecord{}, false, ErrOrderConversationReadOnly
	}
	messageID, err := newID("message")
	if err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_conversation_messages(id,order_id,sender_actor_id,sender_role,body,idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, messageID, orderID, actorID, role, body, idempotencyKey, requestHash, correlationID); err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	result = OrderConversationMessageRecord{ID: messageID, OrderID: orderID, SenderActorID: actorID, SenderRole: role, Body: body, CreatedAt: now, Mine: true, ReadAt: &now}
	if err := tx.Commit(); err != nil {
		return OrderConversationMessageRecord{}, false, err
	}
	return result, false, nil
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
	if _, err := readOrderConversationOrder(ctx, tx, orderID, actorID, role, true); err != nil {
		return time.Time{}, err
	}
	var targetCreatedAt time.Time
	if err := tx.QueryRowContext(ctx, `SELECT created_at FROM dsh.commerce_order_conversation_messages WHERE id=$1 AND order_id=$2`, messageID, orderID).Scan(&targetCreatedAt); errors.Is(err, sql.ErrNoRows) {
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
		ON CONFLICT (actor_id,message_id) DO UPDATE SET read_at=EXCLUDED.read_at`, actorID, orderID, readAt, targetCreatedAt, messageID); err != nil {
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
	err := source.QueryRowContext(ctx, "SELECT id,order_id,sender_actor_id,sender_role,body,created_at,NULL::timestamptz FROM dsh.commerce_order_conversation_messages WHERE "+where, args...).Scan(&item.ID, &item.OrderID, &item.SenderActorID, &item.SenderRole, &item.Body, &item.CreatedAt, &readAt)
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
	err := source.QueryRowContext(ctx, `SELECT o.client_actor_id,s.partner_actor_id,o.state,o.updated_at
		FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE o.id=$1`+lockClause, orderID).Scan(&order.ClientActorID, &order.PartnerActorID, &order.State, &order.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return orderConversationOrder{}, ErrOrderConversationNotFound
	}
	if err != nil {
		return orderConversationOrder{}, err
	}
	if role == "client" && order.ClientActorID != actorID || role == "partner" && order.PartnerActorID != actorID {
		return orderConversationOrder{}, ErrOrderConversationForbidden
	}
	if role == "captain" {
		if err := source.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE order_id=$1 AND captain_actor_id=$2 AND state IN ('assigned','in_custody','delivered','delivery_failed'))`, orderID, actorID).Scan(&order.CaptainParticipant); err != nil {
			return orderConversationOrder{}, err
		}
		if !order.CaptainParticipant {
			return orderConversationOrder{}, ErrOrderConversationForbidden
		}
	}
	return order, nil
}

func (order orderConversationOrder) ReadOnlyAt() *time.Time {
	if order.State != "DELIVERED" && order.State != "REJECTED" && order.State != "CANCELLED" {
		return nil
	}
	value := order.UpdatedAt.Add(orderConversationGracePeriod)
	return &value
}

func conversationResult(orderID string, order orderConversationOrder, now time.Time) OrderConversationRecord {
	readOnlyAt := order.ReadOnlyAt()
	canSend := readOnlyAt == nil || now.Before(*readOnlyAt)
	return OrderConversationRecord{OrderID: orderID, OrderState: order.State, ReadOnlyAt: readOnlyAt, CanSend: canSend}
}

func validConversationRole(role string) bool {
	return role == "client" || role == "partner" || role == "captain"
}
