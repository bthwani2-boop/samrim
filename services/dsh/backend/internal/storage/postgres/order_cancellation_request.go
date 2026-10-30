package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrCancellationRequestInvalid  = errors.New("invalid cancellation assistance request")
	ErrCancellationRequestConflict = errors.New("cancellation request conflict")
	ErrCancellationRequestNotFound = errors.New("cancellation request not found")
)

type CancellationRequestRecord struct {
	ID              string     `json:"id"`
	OrderID         string     `json:"orderId"`
	ClientActorID   string     `json:"clientActorId"`
	Reason          string     `json:"reason"`
	State           string     `json:"state"`
	OperatorActorID *string    `json:"operatorActorId"`
	DecisionReason  *string    `json:"decisionReason"`
	CreatedAt       time.Time  `json:"createdAt"`
	DecidedAt       *time.Time `json:"decidedAt"`
}

const cancellationRequestColumns = "id,order_id,client_actor_id,reason,state,operator_actor_id,decision_reason,created_at,decided_at"

type CancellationRequestPage struct {
	Requests   []CancellationRequestRecord `json:"requests"`
	NextCursor string                      `json:"nextCursor"`
}

type cancellationRequestCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func encodeCancellationRequestCursor(item CancellationRequestRecord) string {
	encoded, _ := json.Marshal(cancellationRequestCursor{CreatedAt: item.CreatedAt, ID: item.ID})
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func decodeCancellationRequestCursor(raw string) (cancellationRequestCursor, error) {
	var cursor cancellationRequestCursor
	if len(raw) > 512 {
		return cursor, ErrCancellationRequestInvalid
	}
	encoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || json.Unmarshal(encoded, &cursor) != nil || cursor.CreatedAt.IsZero() ||
		cursor.ID == "" || len(cursor.ID) > 128 {
		return cancellationRequestCursor{}, ErrCancellationRequestInvalid
	}
	return cursor, nil
}

type cancellationRequestScanner interface{ Scan(...any) error }

func scanCancellationRequest(row cancellationRequestScanner) (CancellationRequestRecord, error) {
	var x CancellationRequestRecord
	err := row.Scan(&x.ID, &x.OrderID, &x.ClientActorID, &x.Reason, &x.State, &x.OperatorActorID, &x.DecisionReason, &x.CreatedAt, &x.DecidedAt)
	return x, err
}
func CreateCancellationRequest(ctx context.Context, db *sql.DB, orderID, clientActorID, reason, idem, correlation string) (CancellationRequestRecord, bool, error) {
	orderID, clientActorID, reason = strings.TrimSpace(orderID), strings.TrimSpace(clientActorID), strings.TrimSpace(reason)
	if db == nil || orderID == "" || clientActorID == "" || len([]rune(reason)) < 12 || len([]rune(reason)) > 500 || len(idem) < 8 || len(idem) > 128 || len(correlation) < 8 || len(correlation) > 128 {
		return CancellationRequestRecord{}, false, ErrCancellationRequestInvalid
	}
	hash := hashFacts("customer-cancel-assistance-v1", orderID, clientActorID, reason)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CancellationRequestRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:cancel-assistance:"+orderID); err != nil {
		return CancellationRequestRecord{}, false, err
	}
	var owner, state string
	err = tx.QueryRowContext(ctx, "SELECT client_actor_id,state FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&owner, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return CancellationRequestRecord{}, false, ErrCancellationRequestNotFound
	}
	if err != nil {
		return CancellationRequestRecord{}, false, err
	}
	if owner != clientActorID {
		return CancellationRequestRecord{}, false, ErrCancellationRequestNotFound
	}
	existing, lookup := scanCancellationRequest(tx.QueryRowContext(ctx, "SELECT "+cancellationRequestColumns+" FROM dsh.order_cancellation_requests WHERE idempotency_key=$1", idem))
	if lookup == nil {
		if existing.OrderID != orderID || existing.ClientActorID != clientActorID || hash != hashFacts("customer-cancel-assistance-v1", existing.OrderID, existing.ClientActorID, existing.Reason) {
			return CancellationRequestRecord{}, false, ErrCancellationRequestConflict
		}
		if err = tx.Commit(); err != nil {
			return CancellationRequestRecord{}, false, err
		}
		return existing, true, nil
	}
	if !errors.Is(lookup, sql.ErrNoRows) {
		return CancellationRequestRecord{}, false, lookup
	}
	if state == "CANCELLED" || state == "REJECTED" || state == "DELIVERED" || state == "PICKED_UP" {
		return CancellationRequestRecord{}, false, ErrCancellationRequestConflict
	}
	_, lookup = scanCancellationRequest(tx.QueryRowContext(ctx, "SELECT "+cancellationRequestColumns+" FROM dsh.order_cancellation_requests WHERE order_id=$1 AND state='PENDING'", orderID))
	if lookup == nil {
		return CancellationRequestRecord{}, false, ErrCancellationRequestConflict
	}
	if !errors.Is(lookup, sql.ErrNoRows) {
		return CancellationRequestRecord{}, false, lookup
	}
	created, err := scanCancellationRequest(tx.QueryRowContext(ctx,
		"INSERT INTO dsh.order_cancellation_requests(order_id,client_actor_id,reason,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING "+cancellationRequestColumns,
		orderID, clientActorID, reason, idem, hash, correlation))
	if err != nil {
		return CancellationRequestRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CancellationRequestRecord{}, false, err
	}
	return created, false, nil
}
func ReadClientCancellationRequest(ctx context.Context, db *sql.DB, orderID, clientActorID string) (CancellationRequestRecord, error) {
	var owner string
	err := db.QueryRowContext(ctx, "SELECT client_actor_id FROM dsh.commerce_orders WHERE id=$1", strings.TrimSpace(orderID)).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return CancellationRequestRecord{}, ErrCancellationRequestNotFound
	}
	if err != nil {
		return CancellationRequestRecord{}, err
	}
	if owner != strings.TrimSpace(clientActorID) {
		return CancellationRequestRecord{}, ErrCancellationRequestNotFound
	}
	x, err := scanCancellationRequest(db.QueryRowContext(ctx,
		"SELECT "+cancellationRequestColumns+" FROM dsh.order_cancellation_requests WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", orderID))
	if errors.Is(err, sql.ErrNoRows) {
		return CancellationRequestRecord{}, ErrCancellationRequestNotFound
	}
	return x, err
}
func ListPendingCancellationRequests(ctx context.Context, db *sql.DB, limit int, rawCursor string) (CancellationRequestPage, error) {
	result := CancellationRequestPage{Requests: []CancellationRequestRecord{}}
	if db == nil || limit < 1 || limit > 100 {
		return result, ErrCancellationRequestInvalid
	}
	position := cancellationRequestCursor{CreatedAt: time.Unix(0, 0).UTC()}
	if rawCursor != "" {
		var err error
		position, err = decodeCancellationRequestCursor(rawCursor)
		if err != nil {
			return result, err
		}
	}
	rows, err := db.QueryContext(ctx, "SELECT "+cancellationRequestColumns+
		" FROM dsh.order_cancellation_requests WHERE state='PENDING' AND (created_at,id)>($1,$2) ORDER BY created_at,id LIMIT $3",
		position.CreatedAt, position.ID, limit+1)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		x, err := scanCancellationRequest(rows)
		if err != nil {
			return result, err
		}
		result.Requests = append(result.Requests, x)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if len(result.Requests) > limit {
		result.Requests = result.Requests[:limit]
		result.NextCursor = encodeCancellationRequestCursor(result.Requests[limit-1])
	}
	return result, nil
}
func DeclineCancellationRequest(ctx context.Context, db *sql.DB, id, operatorID, reason string) (CancellationRequestRecord, error) {
	reason = strings.TrimSpace(reason)
	if id == "" || operatorID == "" || len([]rune(reason)) < 12 || len([]rune(reason)) > 500 {
		return CancellationRequestRecord{}, ErrCancellationRequestInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CancellationRequestRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	x, err := scanCancellationRequest(tx.QueryRowContext(ctx,
		"UPDATE dsh.order_cancellation_requests SET state='DECLINED',operator_actor_id=$2,decision_reason=$3,decided_at=clock_timestamp() WHERE id=$1 AND state='PENDING' RETURNING "+cancellationRequestColumns, id, operatorID, reason))
	if errors.Is(err, sql.ErrNoRows) {
		return CancellationRequestRecord{}, ErrCancellationRequestConflict
	}
	if err != nil {
		return CancellationRequestRecord{}, err
	}
	if err = tx.Commit(); err != nil {
		return CancellationRequestRecord{}, err
	}
	return x, nil
}
