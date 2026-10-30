package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
)

func TransitionOrder(ctx context.Context, db *sql.DB, orderID, requestedState, paymentState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (OrderRecord, bool, error) {
	if strings.TrimSpace(paymentState) != "" {
		return OrderRecord{}, false, ErrPaymentStateConflict
	}
	return transitionOrder(ctx, db, orderID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, "")
}

func TransitionOrderWithPaymentCancellation(ctx context.Context, db *sql.DB, orderID, requestedState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID, cancellationReason string) (OrderRecord, bool, error) {
	return transitionOrder(ctx, db, orderID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, strings.TrimSpace(cancellationReason))
}

// CancelOrderForOperator is the only business-initiated cancellation writer.
// The financial outbox cancels only uncollected obligations and releases holds;
// customer goodwill compensation requires a separate explicit Finance approval.
func CancelOrderForOperator(ctx context.Context, db *sql.DB, orderID string, expectedVersion int, idempotencyKey, actingActorID, correlationID, decisionReason string, partnerReviewed bool) (OrderRecord, bool, error) {
	decisionReason = strings.TrimSpace(decisionReason)
	if len([]rune(decisionReason)) < 12 || len([]rune(decisionReason)) > 500 {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
	}
	return transitionOrder(ctx, db, orderID, "CANCELLED", expectedVersion, idempotencyKey,
		hashFacts("operator-cancel", orderID, decisionReason, strconv.Itoa(expectedVersion), strconv.FormatBool(partnerReviewed)), actingActorID, correlationID, "operator_cancelled", decisionReason, strconv.FormatBool(partnerReviewed))
}

func transitionOrder(ctx context.Context, db *sql.DB, orderID, requestedState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID, cancellationReason string, decisionReason ...string) (OrderRecord, bool, error) {
	if db == nil || strings.TrimSpace(orderID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
	}
	if cancellationReason != "" && requestedState != "REJECTED" && requestedState != "CANCELLED" {
		return OrderRecord{}, false, ErrPaymentStateConflict
	}
	// Reject malformed operator decisions before opening a transaction or
	// changing an Order. The approved writer always supplies reason + review flag.
	if cancellationReason == "operator_cancelled" {
		if requestedState != "CANCELLED" || len(decisionReason) != 2 ||
			(decisionReason[1] != "true" && decisionReason[1] != "false") {
			return OrderRecord{}, false, ErrOrderTransitionInvalid
		}
		reasonLength := len([]rune(strings.TrimSpace(decisionReason[0])))
		if reasonLength < 12 || reasonLength > 500 {
			return OrderRecord{}, false, ErrOrderTransitionInvalid
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:order-transition:"+idempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	var storedHash, storedOrderID, storedState string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,order_id,requested_state FROM dsh.commerce_order_transition_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedOrderID, &storedState)
	if err == nil {
		if storedHash != requestHash || storedOrderID != orderID || storedState != requestedState {
			return OrderRecord{}, false, ErrOrderTransitionConflict
		}
		order, readErr := readOrder(ctx, tx, "o.id=$1", orderID)
		if readErr != nil {
			return OrderRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, err
	}
	current, err := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders o WHERE o.id=$1 FOR UPDATE OF o", orderID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if current.Version != expectedVersion {
		return OrderRecord{}, false, ErrOrderVersionConflict
	}
	if cancellationReason == "client_cancelled" && (current.CancellationMode != "CLIENT_BEFORE_ACCEPTANCE" || current.State != "CREATED" || current.PaymentState != "REQUIRES_COLLECTION") {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	pickupNoShow := cancellationReason == CancellationReasonPickupCustomerNoShow && requestedState == "CANCELLED" && isPickupNoShowCandidate(current)
	operatorCancellation := cancellationReason == "operator_cancelled" && requestedState == "CANCELLED" && (current.State == "CREATED" || current.State == "PARTNER_ACCEPTED" || current.State == "PREPARING")
	if operatorCancellation && (current.State == "PARTNER_ACCEPTED" || current.State == "PREPARING") && decisionReason[1] != "true" {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if !validOrderTransition(current.State, requestedState) && !pickupNoShow && !operatorCancellation {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if (current.FulfillmentMode == FulfillmentModeCustomerPickup && requestedState == "READY_FOR_DISPATCH") || (current.FulfillmentMode != FulfillmentModeCustomerPickup && requestedState == "READY_FOR_PICKUP") {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if requestedState == "READY_FOR_DISPATCH" || requestedState == "READY_FOR_PICKUP" {
		var openAdjustments int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM dsh.commerce_order_adjustments WHERE order_id=$1 AND state IN ('PROPOSED','APPROVED','FINANCIAL_RECONCILIATION_REQUIRED')`, orderID).Scan(&openAdjustments); err != nil {
			return OrderRecord{}, false, err
		}
		if openAdjustments > 0 {
			return OrderRecord{}, false, ErrOrderAdjustmentFinancialRequired
		}
	}
	if cancellationReason != "" {
		if current.PaymentIntentID == nil || current.PaymentState != "REQUIRES_COLLECTION" {
			return OrderRecord{}, false, ErrPaymentStateConflict
		}
		if cancellationReason == CancellationReasonPickupCustomerNoShow && !pickupNoShow {
			return OrderRecord{}, false, ErrOrderStateConflict
		}
	}
	if requestedState == "REJECTED" || requestedState == "CANCELLED" {
		if err := releaseOrderInventoryTx(ctx, tx, orderID); err != nil {
			return OrderRecord{}, false, err
		}
		if err := releaseOrderPromotionRedemptionTx(ctx, tx, orderID, current.PromotionID); err != nil {
			return OrderRecord{}, false, err
		}
	}
	result, err := scanOrder(tx.QueryRowContext(ctx, "UPDATE dsh.commerce_orders AS o SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE o.id=$1 AND o.version=$3 RETURNING "+orderSelectColumns, orderID, requestedState, expectedVersion))
	if err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_transition_idempotency(idempotency_key,request_hash,order_id,requested_state,expected_version,result_version) VALUES($1,$2,$3,$4,$5,$6)", idempotencyKey, requestHash, orderID, requestedState, expectedVersion, result.Version); err != nil {
		return OrderRecord{}, false, err
	}
	eventType := "order_" + strings.ToLower(requestedState)
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", eventType, idempotencyKey, correlationID, actingActorID, orderID, current.State, requestedState, expectedVersion, result.Version, requestHash); err != nil {
		return OrderRecord{}, false, err
	}
	if operatorCancellation {
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.order_cancellation_requests
			SET state='APPROVED',operator_actor_id=$2,decision_reason=$3,decided_at=clock_timestamp()
			WHERE order_id=$1 AND state='PENDING'`, orderID, actingActorID, strings.TrimSpace(decisionReason[0])); err != nil {
			return OrderRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_audit SET decision_reason=$2
			WHERE idempotency_key=$1 AND event_type='order_cancelled'`, idempotencyKey, strings.TrimSpace(decisionReason[0])); err != nil {
			return OrderRecord{}, false, err
		}
	}
	if cancellationReason != "" {
		if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "PAYMENT_CANCEL", SourceRef: idempotencyKey, OrderID: orderID, PaymentIntentID: *current.PaymentIntentID, AmountMinor: current.TotalAmountMinor, Reason: cancellationReason, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
			return OrderRecord{}, false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	order, err := ReadOrder(ctx, db, orderID)
	return order, false, err
}

func HashStorePickupCompletion(orderID, code string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(orderID), HashDeliveryProofCode(orderID, code), strconv.Itoa(expectedVersion), "PICKED_UP")
}

func CompleteStorePickup(ctx context.Context, db *sql.DB, orderID, code string, expectedVersion int, idempotencyKey, actingPartnerActorID, correlationID string, keys *DeliveryProofKeyring) (OrderRecord, bool, error) {
	orderID = strings.TrimSpace(orderID)
	code = strings.TrimSpace(code)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	actingPartnerActorID = strings.TrimSpace(actingPartnerActorID)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || keys == nil || orderID == "" || !validDeliveryProofCode(code) || expectedVersion < 1 || idempotencyKey == "" || actingPartnerActorID == "" || correlationID == "" {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
	}
	requestHash, err := keys.ActiveIdempotencyHash("store-pickup-completion", orderID, code, strconv.Itoa(expectedVersion), "PICKED_UP")
	if err != nil {
		return OrderRecord{}, false, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:order-transition:"+idempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	var storedHash, storedOrderID, storedState string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,order_id,requested_state FROM dsh.commerce_order_transition_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedOrderID, &storedState)
	if err == nil {
		if !keys.VerifyIdempotencyHash(storedHash, "store-pickup-completion", orderID, code, strconv.Itoa(expectedVersion), "PICKED_UP") || storedOrderID != orderID || storedState != "PICKED_UP" {
			return OrderRecord{}, false, ErrOrderTransitionConflict
		}
		order, readErr := readOrder(ctx, tx, "o.id=$1", orderID)
		if readErr != nil {
			return OrderRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, err
	}
	current, err := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders o WHERE o.id=$1 FOR UPDATE OF o", orderID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if current.Version != expectedVersion {
		return OrderRecord{}, false, ErrOrderVersionConflict
	}
	if current.FulfillmentMode != FulfillmentModeCustomerPickup || current.State != "READY_FOR_PICKUP" || current.PaymentMethod != "CASH_AT_STORE" || current.PaymentIntentID == nil || current.PaymentState != "REQUIRES_COLLECTION" {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	var storePartnerActorID string
	if err := tx.QueryRowContext(ctx, "SELECT partner_actor_id FROM dsh.stores WHERE id=$1 FOR SHARE", current.StoreID).Scan(&storePartnerActorID); err != nil {
		return OrderRecord{}, false, err
	}
	if storePartnerActorID != actingPartnerActorID {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	var proofHash, proofState, proofType, proofKeyID string
	if err := tx.QueryRowContext(ctx, `SELECT code_verifier,state,proof_type,code_key_id FROM dsh.commerce_order_delivery_proofs WHERE order_id=$1 AND client_actor_id=$2 FOR UPDATE`, orderID, current.ClientActorID).Scan(&proofHash, &proofState, &proofType, &proofKeyID); err != nil {
		return OrderRecord{}, false, err
	}
	if proofType != "STORE_PICKUP" || proofState != "PENDING" {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if !keys.VerifyProof(orderID, proofKeyID, proofHash, code) {
		return OrderRecord{}, false, ErrStorePickupProofInvalid
	}
	if err := consumeOrderInventoryTx(ctx, tx, orderID); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_delivery_proofs SET state='VERIFIED',code_ciphertext=NULL,code_verifier=NULL,code_key_id=NULL,verified_by=$2,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE order_id=$1 AND state='PENDING'`, orderID, actingPartnerActorID); err != nil {
		return OrderRecord{}, false, err
	}
	result, err := scanOrder(tx.QueryRowContext(ctx, "UPDATE dsh.commerce_orders AS o SET state='PICKED_UP',version=version+1,updated_at=clock_timestamp() WHERE o.id=$1 AND o.version=$2 RETURNING "+orderSelectColumns, orderID, expectedVersion))
	if err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_transition_idempotency(idempotency_key,request_hash,order_id,requested_state,expected_version,result_version) VALUES($1,$2,$3,'PICKED_UP',$4,$5)`, idempotencyKey, requestHash, orderID, expectedVersion, result.Version); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES('order_picked_up',$1,$2,$3,$4,$5,'PICKED_UP',$6,$7,$8)`, idempotencyKey, correlationID, actingPartnerActorID, orderID, current.State, expectedVersion, result.Version, requestHash); err != nil {
		return OrderRecord{}, false, err
	}
	if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "STORE_PICKUP_COLLECTION", SourceRef: idempotencyKey, OrderID: orderID, PaymentIntentID: *current.PaymentIntentID, PartnerActorID: actingPartnerActorID, AmountMinor: current.PaymentCashAmountMinor, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingPartnerActorID}); err != nil {
		return OrderRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	order, err := ReadOrder(ctx, db, orderID)
	return order, false, err
}

func ConfirmStoreCaptainCashHandoff(ctx context.Context, db *sql.DB, storeID, orderID, actingPartnerActorID string, expectedVersion int, idempotencyKey, correlationID string) (OrderRecord, bool, error) {
	storeID, orderID, actingPartnerActorID = strings.TrimSpace(storeID), strings.TrimSpace(orderID), strings.TrimSpace(actingPartnerActorID)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || orderID == "" || actingPartnerActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
	}
	requestHash := hashFacts("store-captain-cash-handoff-confirm", storeID, orderID, actingPartnerActorID, strconv.Itoa(expectedVersion))
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:store-captain-cash-handoff:"+idempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	var storedHash, storedOrderID string
	err = tx.QueryRowContext(ctx, `SELECT confirmation_request_hash,order_id FROM dsh.commerce_order_store_cash_handoffs WHERE confirmation_idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedOrderID)
	if err == nil {
		if storedHash != requestHash || storedOrderID != orderID {
			return OrderRecord{}, false, ErrOrderTransitionConflict
		}
		order, readErr := readOrder(ctx, tx, "o.id=$1 AND o.store_id=$2", orderID, storeID)
		if readErr != nil {
			return OrderRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, err
	}
	current, err := scanOrderWithStore(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumnsWithStore+" FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE o.id=$1 AND o.store_id=$2 FOR UPDATE OF o", orderID, storeID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if current.Version != expectedVersion {
		return OrderRecord{}, false, ErrOrderVersionConflict
	}
	if current.FulfillmentMode != FulfillmentModePartnerCaptain || current.State != "DELIVERED" || current.PaymentMethod != "CASH_AT_STORE" || current.PaymentState != "REQUIRES_COLLECTION" || current.PaymentIntentID == nil || current.PaymentCashAmountMinor < 1 {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	var state, assignmentID, captainActorID, partnerActorID string
	var amountMinor int64
	if err := tx.QueryRowContext(ctx, `SELECT state,assignment_id,captain_actor_id,partner_actor_id,amount_minor FROM dsh.commerce_order_store_cash_handoffs WHERE order_id=$1 FOR UPDATE`, orderID).Scan(&state, &assignmentID, &captainActorID, &partnerActorID, &amountMinor); errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderStateConflict
	} else if err != nil {
		return OrderRecord{}, false, err
	}
	if state != "AWAITING_STORE_HANDOFF" || partnerActorID != actingPartnerActorID || amountMinor != current.PaymentCashAmountMinor {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_store_cash_handoffs
		SET state='STORE_CONFIRMED',store_confirmed_by=$2,store_confirmed_at=clock_timestamp(),confirmation_idempotency_key=$3,confirmation_request_hash=$4,version=version+1,updated_at=clock_timestamp()
		WHERE order_id=$1 AND state='AWAITING_STORE_HANDOFF' AND version=1`, orderID, actingPartnerActorID, idempotencyKey, requestHash)
	if err != nil {
		return OrderRecord{}, false, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return OrderRecord{}, false, err
		}
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "PARTNER_CAPTAIN_STORE_CASH_COLLECTION", SourceRef: assignmentID, OrderID: orderID, PaymentIntentID: *current.PaymentIntentID, CaptainActorID: captainActorID, PartnerActorID: actingPartnerActorID, AmountMinor: amountMinor, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingPartnerActorID}); err != nil {
		return OrderRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	order, err := ReadOrder(ctx, db, orderID)
	return order, false, err
}

func validOrderTransition(from, to string) bool {
	switch from {
	case "CREATED":
		return to == "PARTNER_ACCEPTED" || to == "REJECTED" || to == "CANCELLED"
	case "PARTNER_ACCEPTED":
		return to == "PREPARING"
	case "PREPARING":
		return to == "READY_FOR_DISPATCH" || to == "READY_FOR_PICKUP"
	default:
		return false
	}
}

func isPickupNoShowCandidate(order OrderRecord) bool {
	return order.State == "READY_FOR_PICKUP" && order.FulfillmentMode == FulfillmentModeCustomerPickup && order.PaymentMethod == "CASH_AT_STORE" && order.PaymentIntentID != nil && order.PaymentState == "REQUIRES_COLLECTION"
}

func quantityValue(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
