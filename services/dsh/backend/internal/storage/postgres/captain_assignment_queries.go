package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

func ReadCaptainAssignment(ctx context.Context, db *sql.DB, assignmentID string) (CaptainAssignment, error) {
	if db == nil || strings.TrimSpace(assignmentID) == "" {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAssignment{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var actorID string
	if err := tx.QueryRowContext(ctx, `SELECT captain_actor_id FROM dsh.captain_assignments WHERE id=$1`, strings.TrimSpace(assignmentID)).Scan(&actorID); errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	} else if err != nil {
		return CaptainAssignment{}, err
	}
	if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
		return CaptainAssignment{}, err
	}
	assignment, err := readCaptainAssignmentTx(ctx, tx, "id=$1", strings.TrimSpace(assignmentID))
	if err != nil {
		return CaptainAssignment{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAssignment{}, err
	}
	return assignment, nil
}

func ReadCaptainAssignmentForOrder(ctx context.Context, db *sql.DB, orderID string) (CaptainAssignment, error) {
	if db == nil || strings.TrimSpace(orderID) == "" {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAssignment{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var actorID string
	if err := tx.QueryRowContext(ctx, `SELECT captain_actor_id FROM dsh.captain_assignments WHERE order_id=$1 AND state IN ('assigned','in_custody','delivered','delivery_failed') ORDER BY created_at DESC LIMIT 1`, strings.TrimSpace(orderID)).Scan(&actorID); errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	} else if err != nil {
		return CaptainAssignment{}, err
	}
	if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
		return CaptainAssignment{}, err
	}
	assignment, err := readCaptainAssignmentTx(ctx, tx, "order_id=$1 AND state IN ('assigned','in_custody','delivered','delivery_failed')", strings.TrimSpace(orderID))
	if err != nil {
		return CaptainAssignment{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAssignment{}, err
	}
	return assignment, nil
}

// ReadLatestCaptainAssignmentForOrder includes reassigned history so a
// cross-service compensation can release the former captain's COD hold after
// DSH has atomically moved the order to a new offer.
func ReadLatestCaptainAssignmentForOrder(ctx context.Context, db *sql.DB, orderID string) (CaptainAssignment, error) {
	if db == nil || strings.TrimSpace(orderID) == "" {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAssignment{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var assignmentID string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM dsh.captain_assignments WHERE order_id=$1 ORDER BY created_at DESC,updated_at DESC LIMIT 1`, strings.TrimSpace(orderID)).Scan(&assignmentID); errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	} else if err != nil {
		return CaptainAssignment{}, err
	}
	assignment, err := readCaptainAssignmentTx(ctx, tx, "id=$1", assignmentID)
	if err != nil {
		return CaptainAssignment{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAssignment{}, err
	}
	return assignment, nil
}

// ReadCaptainDeliveryTask is the bounded Captain projection. Its joins are
// intentionally server-side so a client cannot compose a task from generic
// order, store, or address reads.
func ReadCaptainDeliveryTask(ctx context.Context, db *sql.DB, assignmentID, captainActorID string) (CaptainDeliveryTask, error) {
	if db == nil || strings.TrimSpace(assignmentID) == "" || strings.TrimSpace(captainActorID) == "" {
		return CaptainDeliveryTask{}, ErrCaptainDeliveryTaskNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainDeliveryTask{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, strings.TrimSpace(captainActorID)); err != nil {
		return CaptainDeliveryTask{}, err
	}
	var task CaptainDeliveryTask
	var pickupLatitude, pickupLongitude, destinationLatitude, destinationLongitude sql.NullFloat64
	var recipientName, recipientPhone, recipientInstructions, paymentIntentID sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT a.id,a.order_id,s.id,s.name,COALESCE((SELECT uri FROM dsh.store_profile_media_assets m WHERE m.store_id=s.id AND m.state='active' AND m.rights_attested_at IS NOT NULL LIMIT 1),''),s.delivery_origin_latitude,s.delivery_origin_longitude,o.address_text,o.address_latitude,o.address_longitude,o.state,h.state,a.state,o.payment_method,o.payment_state,o.payment_cash_amount_minor,o.currency,o.fulfillment_mode,o.recipient_mode,o.recipient_name,o.recipient_phone_e164,o.recipient_instructions,o.payment_intent_id
		FROM dsh.captain_assignments a
		JOIN dsh.captain_handoffs h ON h.assignment_id=a.id
		JOIN dsh.commerce_orders o ON o.id=a.order_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE a.id=$1 AND a.captain_actor_id=$2 AND a.state IN ('assigned','in_custody','delivery_failed') AND o.state NOT IN ('DELIVERED','PICKED_UP','REJECTED','CANCELLED')`, strings.TrimSpace(assignmentID), strings.TrimSpace(captainActorID)).Scan(
		&task.AssignmentID, &task.OrderReference, &task.StoreID, &task.StoreName, &task.StoreProfileImageURI, &pickupLatitude, &pickupLongitude,
		&task.CustomerAddressText, &destinationLatitude, &destinationLongitude, &task.OrderState, &task.HandoffState, &task.DeliveryState,
		&task.PaymentMethod, &task.PaymentState, &task.AmountDueMinor, &task.Currency, &task.FulfillmentMode,
		&task.Recipient.Mode, &recipientName, &recipientPhone, &recipientInstructions, &paymentIntentID)
	if paymentIntentID.Valid {
		task.PaymentIntentID = paymentIntentID.String
	}
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainDeliveryTask{}, ErrCaptainDeliveryTaskNotFound
	}
	if err != nil {
		return CaptainDeliveryTask{}, err
	}
	if !pickupLatitude.Valid || !pickupLongitude.Valid || !destinationLatitude.Valid || !destinationLongitude.Valid || strings.TrimSpace(task.CustomerAddressText) == "" {
		return CaptainDeliveryTask{}, ErrCaptainDeliveryTaskInvalid
	}
	task.PickupLatitude = pickupLatitude.Float64
	task.PickupLongitude = pickupLongitude.Float64
	task.DestinationLatitude = destinationLatitude.Float64
	task.DestinationLongitude = destinationLongitude.Float64
	if recipientName.Valid {
		value := recipientName.String
		task.Recipient.Name = &value
	}
	if recipientPhone.Valid {
		value := recipientPhone.String
		task.Recipient.PhoneE164 = &value
	}
	if recipientInstructions.Valid {
		value := recipientInstructions.String
		task.Recipient.Instructions = &value
	}
	if err := tx.Commit(); err != nil {
		return CaptainDeliveryTask{}, err
	}
	return task, nil
}

func ListCaptainAssignments(ctx context.Context, db *sql.DB, actorID string, limit int) ([]CaptainAssignment, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || limit < 1 || limit > 100 {
		return nil, ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, strings.TrimSpace(actorID)); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody','delivery_failed') ORDER BY created_at DESC,id DESC LIMIT $2`, actorID, limit)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	items := make([]CaptainAssignment, 0, len(ids))
	for _, id := range ids {
		item, err := readCaptainAssignmentTx(ctx, tx, "id=$1", id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return items, nil
}
