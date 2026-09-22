package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrOrderRatingNotFound      = errors.New("order rating was not found")
	ErrOrderRatingNotEligible   = errors.New("order is not eligible for rating")
	ErrOrderRatingAlreadyExists = errors.New("order already has a rating")
	ErrOrderRatingIdempotency   = errors.New("order rating idempotency key was already used with different facts")
	ErrOrderRatingInvalid       = errors.New("order rating input is invalid")
)

type OrderRatingRecord struct {
	OrderID       string
	ClientActorID string
	StoreID       string
	Rating        int
	Review        string
	CreatedAt     time.Time
}

func HashOrderRatingRequest(orderID string, rating int, review string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(orderID), strconv.Itoa(rating), strings.TrimSpace(review), strconv.Itoa(expectedVersion))
}

func ReadClientOrderRating(ctx context.Context, db *sql.DB, orderID, clientActorID string) (OrderRatingRecord, error) {
	if db == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(clientActorID) == "" {
		return OrderRatingRecord{}, ErrOrderRatingNotFound
	}
	return readOrderRating(ctx, db, "order_id=$1 AND client_actor_id=$2", strings.TrimSpace(orderID), strings.TrimSpace(clientActorID))
}

func readOrderRating(ctx context.Context, source queryer, where string, args ...any) (OrderRatingRecord, error) {
	var rating OrderRatingRecord
	rows, err := source.QueryContext(ctx, "SELECT order_id,client_actor_id,store_id,rating,review,created_at FROM dsh.commerce_order_ratings WHERE "+where, args...)
	if err != nil {
		return OrderRatingRecord{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return OrderRatingRecord{}, ErrOrderRatingNotFound
	}
	if err := rows.Scan(&rating.OrderID, &rating.ClientActorID, &rating.StoreID, &rating.Rating, &rating.Review, &rating.CreatedAt); err != nil {
		return OrderRatingRecord{}, err
	}
	return rating, nil
}

func CreateClientOrderRating(ctx context.Context, db *sql.DB, orderID, clientActorID string, rating int, review string, expectedVersion int, idempotencyKey, requestHash, correlationID string) (result OrderRatingRecord, replayed bool, returnErr error) {
	orderID = strings.TrimSpace(orderID)
	clientActorID = strings.TrimSpace(clientActorID)
	review = strings.TrimSpace(review)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	requestHash = strings.TrimSpace(requestHash)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || orderID == "" || clientActorID == "" || rating < 1 || rating > 5 || !utf8.ValidString(review) || utf8.RuneCountInString(review) > 1000 || expectedVersion < 1 || idempotencyKey == "" || requestHash == "" || correlationID == "" {
		return OrderRatingRecord{}, false, ErrOrderRatingInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRatingRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:order-rating:"+idempotencyKey); err != nil {
		return OrderRatingRecord{}, false, err
	}
	var storedHash, storedOrderID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,order_id FROM dsh.commerce_order_ratings WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedOrderID)
	if err == nil {
		if storedHash != requestHash || storedOrderID != orderID {
			return OrderRatingRecord{}, false, ErrOrderRatingIdempotency
		}
		result, err = readOrderRating(ctx, tx, "order_id=$1", orderID)
		if err != nil {
			return OrderRatingRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return OrderRatingRecord{}, false, err
		}
		return result, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRatingRecord{}, false, err
	}
	var storedClientActorID, storeID, state string
	var version int
	err = tx.QueryRowContext(ctx, "SELECT client_actor_id,store_id,state,version FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&storedClientActorID, &storeID, &state, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRatingRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRatingRecord{}, false, err
	}
	if storedClientActorID != clientActorID {
		return OrderRatingRecord{}, false, ErrOrderNotFound
	}
	if state != "DELIVERED" {
		return OrderRatingRecord{}, false, ErrOrderRatingNotEligible
	}
	if version != expectedVersion {
		return OrderRatingRecord{}, false, ErrOrderVersionConflict
	}
	var existingOrderID string
	if err := tx.QueryRowContext(ctx, `SELECT order_id FROM dsh.commerce_order_ratings WHERE order_id=$1 FOR UPDATE`, orderID).Scan(&existingOrderID); err == nil {
		return OrderRatingRecord{}, false, ErrOrderRatingAlreadyExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return OrderRatingRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_ratings(order_id,client_actor_id,store_id,rating,review,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`, orderID, clientActorID, storeID, rating, review, idempotencyKey, requestHash); err != nil {
		return OrderRatingRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_rating_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,client_actor_id,store_id,rating,review,request_hash) VALUES('order_rated',$1,$2,$3,$4,$5,$6,$7,$8,$9)`, idempotencyKey, correlationID, clientActorID, orderID, clientActorID, storeID, rating, review, requestHash); err != nil {
		return OrderRatingRecord{}, false, err
	}
	result, err = readOrderRating(ctx, tx, "order_id=$1", orderID)
	if err != nil {
		return OrderRatingRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRatingRecord{}, false, err
	}
	return result, false, nil
}
