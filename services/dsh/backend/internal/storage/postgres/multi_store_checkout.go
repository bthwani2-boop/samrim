package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrMultiStoreCheckoutInvalid             = errors.New("multi-store checkout input is invalid")
	ErrMultiStoreCheckoutNotFound            = errors.New("multi-store checkout was not found")
	ErrMultiStoreCheckoutIdempotencyConflict = errors.New("multi-store checkout idempotency key was already used with different facts")
	ErrMultiStoreCheckoutVersionConflict     = errors.New("multi-store checkout version is stale")
	ErrMultiStoreCheckoutChildConflict       = errors.New("multi-store checkout child state is stale")
)

type MultiStoreCheckoutChildInput struct {
	CartID          string
	StoreID         string
	AddressID       string
	CartVersion     int
	FulfillmentMode string
	PromotionCode   string
}

type MultiStoreCheckoutInput struct {
	ID            string
	ClientActorID string
	Children      []MultiStoreCheckoutChildInput
}

type MultiStoreCheckoutChildRecord struct {
	ID              string
	ChildIndex      int
	CartID          string
	StoreID         string
	StoreName       string
	AddressID       string
	CartVersion     int
	FulfillmentMode string
	PromotionCode   string
	OrderID         string
	State           string
	FailureCode     string
	FailureMessage  string
	Version         int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type MultiStoreCheckoutRecord struct {
	ID                   string
	ClientActorID        string
	State                string
	Version              int
	ChildCount           int
	SuccessfulChildCount int
	FailedChildCount     int
	Children             []MultiStoreCheckoutChildRecord
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

func HashMultiStoreCheckoutRequest(input MultiStoreCheckoutInput) string {
	payload := struct {
		ID            string                         `json:"id"`
		ClientActorID string                         `json:"clientActorId"`
		Children      []MultiStoreCheckoutChildInput `json:"children"`
	}{ID: strings.TrimSpace(input.ID), ClientActorID: strings.TrimSpace(input.ClientActorID), Children: input.Children}
	raw, _ := json.Marshal(payload)
	return HashMarketingFacts(string(raw))
}

func HashMultiStoreCheckoutCancelRequest(checkoutID string, expectedVersion int) string {
	return HashMarketingFacts("cancel", strings.TrimSpace(checkoutID), fmt.Sprint(expectedVersion))
}

const multiStoreCheckoutSelect = `id,client_actor_id,state,version,child_count,successful_child_count,failed_child_count,created_at,updated_at`
const multiStoreCheckoutChildSelect = `c.id,c.child_index,c.cart_id,c.store_id,s.name,c.address_id,c.cart_version,c.fulfillment_mode,COALESCE(c.promotion_code,''),COALESCE(c.order_id,''),c.state,COALESCE(c.failure_code,''),COALESCE(c.failure_message,''),c.version,c.created_at,c.updated_at`

func validateMultiStoreCheckoutChildren(children []MultiStoreCheckoutChildInput) error {
	if len(children) < 2 || len(children) > 10 {
		return ErrMultiStoreCheckoutInvalid
	}
	seenCarts := make(map[string]struct{}, len(children))
	seenStores := make(map[string]struct{}, len(children))
	for _, child := range children {
		cartID, storeID, addressID := strings.TrimSpace(child.CartID), strings.TrimSpace(child.StoreID), strings.TrimSpace(child.AddressID)
		mode := strings.TrimSpace(child.FulfillmentMode)
		pickup := mode == "CUSTOMER_PICKUP"
		delivery := mode == "BTHWANI_CAPTAIN" || mode == "PARTNER_CAPTAIN"
		if cartID == "" || storeID == "" || child.CartVersion < 1 || (!pickup && !delivery) || (pickup && addressID != "") || (delivery && addressID == "") {
			return ErrMultiStoreCheckoutInvalid
		}
		if _, exists := seenCarts[cartID]; exists {
			return ErrMultiStoreCheckoutInvalid
		}
		if _, exists := seenStores[storeID]; exists {
			return ErrMultiStoreCheckoutInvalid
		}
		seenCarts[cartID], seenStores[storeID] = struct{}{}, struct{}{}
	}
	return nil
}

func CreateMultiStoreCheckout(ctx context.Context, db *sql.DB, input MultiStoreCheckoutInput, idempotencyKey, requestHash string) (MultiStoreCheckoutRecord, bool, error) {
	if db == nil || strings.TrimSpace(input.ID) == "" || strings.TrimSpace(input.ClientActorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return MultiStoreCheckoutRecord{}, false, ErrMultiStoreCheckoutInvalid
	}
	if err := validateMultiStoreCheckoutChildren(input.Children); err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:multi-store-checkout:idempotency:"+strings.TrimSpace(idempotencyKey)); err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	var storedHash, checkoutID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,checkout_id,operation FROM dsh.commerce_multi_store_checkout_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &checkoutID, &operation)
	if err == nil {
		if operation != "CREATE" || storedHash != requestHash || checkoutID != strings.TrimSpace(input.ID) {
			return MultiStoreCheckoutRecord{}, false, ErrMultiStoreCheckoutIdempotencyConflict
		}
		item, readErr := readMultiStoreCheckoutTx(ctx, tx, checkoutID, input.ClientActorID)
		if readErr != nil {
			return MultiStoreCheckoutRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return MultiStoreCheckoutRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MultiStoreCheckoutRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_multi_store_checkouts(id,client_actor_id,state,child_count) VALUES($1,$2,'PROCESSING',$3)`, strings.TrimSpace(input.ID), strings.TrimSpace(input.ClientActorID), len(input.Children)); err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	for index, child := range input.Children {
		childID, idErr := newID("multi-store-child")
		if idErr != nil {
			return MultiStoreCheckoutRecord{}, false, idErr
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_multi_store_checkout_children(id,checkout_id,child_index,cart_id,store_id,address_id,cart_version,fulfillment_mode,promotion_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,''))`, childID, strings.TrimSpace(input.ID), index, strings.TrimSpace(child.CartID), strings.TrimSpace(child.StoreID), strings.TrimSpace(child.AddressID), child.CartVersion, strings.TrimSpace(child.FulfillmentMode), strings.TrimSpace(child.PromotionCode)); err != nil {
			return MultiStoreCheckoutRecord{}, false, err
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_multi_store_checkout_idempotency(idempotency_key,request_hash,checkout_id,operation,expected_version,result_version) VALUES($1,$2,$3,'CREATE',0,1)", strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(input.ID)); err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	item, err := readMultiStoreCheckoutTx(ctx, tx, input.ID, input.ClientActorID)
	if err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	return item, false, nil
}

func ReadMultiStoreCheckoutForClient(ctx context.Context, db *sql.DB, checkoutID, clientActorID string) (MultiStoreCheckoutRecord, error) {
	if db == nil || strings.TrimSpace(checkoutID) == "" || strings.TrimSpace(clientActorID) == "" {
		return MultiStoreCheckoutRecord{}, ErrMultiStoreCheckoutNotFound
	}
	return readMultiStoreCheckout(ctx, db, checkoutID, clientActorID)
}

func readMultiStoreCheckout(ctx context.Context, db rowQueryer, checkoutID, clientActorID string) (MultiStoreCheckoutRecord, error) {
	return readMultiStoreCheckoutTx(ctx, db, checkoutID, clientActorID)
}

func readMultiStoreCheckoutTx(ctx context.Context, db rowQueryer, checkoutID, clientActorID string) (MultiStoreCheckoutRecord, error) {
	var item MultiStoreCheckoutRecord
	err := db.QueryRowContext(ctx, "SELECT "+multiStoreCheckoutSelect+" FROM dsh.commerce_multi_store_checkouts WHERE id=$1 AND ($2='' OR client_actor_id=$2)", strings.TrimSpace(checkoutID), strings.TrimSpace(clientActorID)).Scan(&item.ID, &item.ClientActorID, &item.State, &item.Version, &item.ChildCount, &item.SuccessfulChildCount, &item.FailedChildCount, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return MultiStoreCheckoutRecord{}, ErrMultiStoreCheckoutNotFound
	}
	if err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	rows, err := db.QueryContext(ctx, "SELECT "+multiStoreCheckoutChildSelect+" FROM dsh.commerce_multi_store_checkout_children c JOIN dsh.stores s ON s.id=c.store_id WHERE c.checkout_id=$1 ORDER BY c.child_index", strings.TrimSpace(checkoutID))
	if err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	defer rows.Close()
	item.Children = make([]MultiStoreCheckoutChildRecord, 0, item.ChildCount)
	for rows.Next() {
		var child MultiStoreCheckoutChildRecord
		if err := rows.Scan(&child.ID, &child.ChildIndex, &child.CartID, &child.StoreID, &child.StoreName, &child.AddressID, &child.CartVersion, &child.FulfillmentMode, &child.PromotionCode, &child.OrderID, &child.State, &child.FailureCode, &child.FailureMessage, &child.Version, &child.CreatedAt, &child.UpdatedAt); err != nil {
			return MultiStoreCheckoutRecord{}, err
		}
		item.Children = append(item.Children, child)
	}
	if err := rows.Err(); err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	return item, nil
}

func MarkMultiStoreCheckoutChildSucceeded(ctx context.Context, db *sql.DB, checkoutID, childID, orderID string) (MultiStoreCheckoutRecord, error) {
	return updateMultiStoreCheckoutChild(ctx, db, checkoutID, childID, "SUCCEEDED", strings.TrimSpace(orderID), "", "")
}

func MarkMultiStoreCheckoutChildFailed(ctx context.Context, db *sql.DB, checkoutID, childID, code, message string) (MultiStoreCheckoutRecord, error) {
	return updateMultiStoreCheckoutChild(ctx, db, checkoutID, childID, "FAILED", "", strings.TrimSpace(code), strings.TrimSpace(message))
}

func MarkMultiStoreCheckoutChildCancelled(ctx context.Context, db *sql.DB, checkoutID, childID string) (MultiStoreCheckoutRecord, error) {
	return updateMultiStoreCheckoutChild(ctx, db, checkoutID, childID, "CANCELLED", "__KEEP_ORDER__", "", "")
}

func MarkMultiStoreCheckoutChildCancelFailed(ctx context.Context, db *sql.DB, checkoutID, childID, code, message string) (MultiStoreCheckoutRecord, error) {
	return updateMultiStoreCheckoutChild(ctx, db, checkoutID, childID, "CANCEL_FAILED", "__KEEP_ORDER__", strings.TrimSpace(code), strings.TrimSpace(message))
}

func updateMultiStoreCheckoutChild(ctx context.Context, db *sql.DB, checkoutID, childID, state, orderID, failureCode, failureMessage string) (MultiStoreCheckoutRecord, error) {
	if db == nil || strings.TrimSpace(checkoutID) == "" || strings.TrimSpace(childID) == "" {
		return MultiStoreCheckoutRecord{}, ErrMultiStoreCheckoutInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:multi-store-checkout:"+strings.TrimSpace(checkoutID)); err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	var currentState, currentOrderID string
	err = tx.QueryRowContext(ctx, "SELECT state,COALESCE(order_id,'') FROM dsh.commerce_multi_store_checkout_children WHERE id=$1 AND checkout_id=$2 FOR UPDATE", childID, checkoutID).Scan(&currentState, &currentOrderID)
	if errors.Is(err, sql.ErrNoRows) {
		return MultiStoreCheckoutRecord{}, ErrMultiStoreCheckoutNotFound
	}
	if err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	if currentState == "CANCELLED" || currentState == "CANCEL_FAILED" || currentState == "SUCCEEDED" && state == "FAILED" {
		item, readErr := readMultiStoreCheckoutTx(ctx, tx, checkoutID, "")
		if readErr != nil {
			return MultiStoreCheckoutRecord{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return MultiStoreCheckoutRecord{}, err
		}
		return item, nil
	}
	if orderID == "__KEEP_ORDER__" {
		orderID = currentOrderID
	}
	if state == "SUCCEEDED" && strings.TrimSpace(orderID) == "" {
		return MultiStoreCheckoutRecord{}, ErrMultiStoreCheckoutChildConflict
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_multi_store_checkout_children SET state=$3,order_id=NULLIF($4,''),failure_code=NULLIF($5,''),failure_message=NULLIF($6,''),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND checkout_id=$2`, childID, checkoutID, state, orderID, failureCode, failureMessage); err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	if err := reconcileMultiStoreCheckoutTx(ctx, tx, checkoutID); err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	item, err := readMultiStoreCheckoutTx(ctx, tx, checkoutID, "")
	if err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return MultiStoreCheckoutRecord{}, err
	}
	return item, nil
}

func BeginMultiStoreCheckoutCancel(ctx context.Context, db *sql.DB, checkoutID, clientActorID, idempotencyKey, requestHash string, expectedVersion int) (MultiStoreCheckoutRecord, bool, error) {
	if db == nil || strings.TrimSpace(checkoutID) == "" || strings.TrimSpace(clientActorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || expectedVersion < 1 {
		return MultiStoreCheckoutRecord{}, false, ErrMultiStoreCheckoutInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:multi-store-checkout:idempotency:"+strings.TrimSpace(idempotencyKey)); err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	var storedHash, storedCheckoutID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,checkout_id,operation FROM dsh.commerce_multi_store_checkout_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedCheckoutID, &operation)
	if err == nil {
		if operation != "CANCEL" || storedHash != requestHash || storedCheckoutID != checkoutID {
			return MultiStoreCheckoutRecord{}, false, ErrMultiStoreCheckoutIdempotencyConflict
		}
		item, readErr := readMultiStoreCheckoutTx(ctx, tx, checkoutID, clientActorID)
		if readErr != nil {
			return MultiStoreCheckoutRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return MultiStoreCheckoutRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MultiStoreCheckoutRecord{}, false, err
	}
	var currentVersion int
	if err := tx.QueryRowContext(ctx, "SELECT version FROM dsh.commerce_multi_store_checkouts WHERE id=$1 AND client_actor_id=$2 FOR UPDATE", checkoutID, clientActorID).Scan(&currentVersion); errors.Is(err, sql.ErrNoRows) {
		return MultiStoreCheckoutRecord{}, false, ErrMultiStoreCheckoutNotFound
	} else if err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	if currentVersion != expectedVersion {
		return MultiStoreCheckoutRecord{}, false, ErrMultiStoreCheckoutVersionConflict
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_multi_store_checkout_idempotency(idempotency_key,request_hash,checkout_id,operation,expected_version,result_version) VALUES($1,$2,$3,'CANCEL',$4,$5)", idempotencyKey, requestHash, checkoutID, expectedVersion, currentVersion); err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	item, err := readMultiStoreCheckoutTx(ctx, tx, checkoutID, clientActorID)
	if err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return MultiStoreCheckoutRecord{}, false, err
	}
	return item, false, nil
}

func CompleteMultiStoreCheckoutMutation(ctx context.Context, db *sql.DB, idempotencyKey string, resultVersion int) error {
	if db == nil || strings.TrimSpace(idempotencyKey) == "" || resultVersion < 1 {
		return ErrMultiStoreCheckoutInvalid
	}
	_, err := db.ExecContext(ctx, "UPDATE dsh.commerce_multi_store_checkout_idempotency SET result_version=$2 WHERE idempotency_key=$1", idempotencyKey, resultVersion)
	return err
}

func reconcileMultiStoreCheckoutTx(ctx context.Context, tx *sql.Tx, checkoutID string) error {
	var successful, failed, pending, cancelled, cancelFailed int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FILTER (WHERE state IN ('SUCCEEDED','CANCELLED')),COUNT(*) FILTER (WHERE state='FAILED'),COUNT(*) FILTER (WHERE state='PENDING'),COUNT(*) FILTER (WHERE state='CANCELLED'),COUNT(*) FILTER (WHERE state='CANCEL_FAILED') FROM dsh.commerce_multi_store_checkout_children WHERE checkout_id=$1`, checkoutID).Scan(&successful, &failed, &pending, &cancelled, &cancelFailed); err != nil {
		return err
	}
	var state string
	switch {
	case pending > 0:
		state = "PROCESSING"
	case cancelFailed > 0:
		state = "PARTIAL_FAILURE"
	case cancelled > 0:
		state = "CANCELLED"
	case failed > 0 && successful == 0:
		state = "FAILED"
	case failed > 0:
		state = "PARTIAL_FAILURE"
	default:
		state = "COMPLETE"
	}
	_, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_multi_store_checkouts SET state=$2,successful_child_count=$3,failed_child_count=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND (state IS DISTINCT FROM $2 OR successful_child_count IS DISTINCT FROM $3 OR failed_child_count IS DISTINCT FROM $4)`, checkoutID, state, successful, failed+cancelFailed)
	return err
}
