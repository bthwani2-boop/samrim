package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func ReassignCaptain(ctx context.Context, db *sql.DB, orderID, idempotencyKey, requestHash, actingActorID, correlationID string, approvedCaptainIDs ...string) (CaptainOffer, bool, error) {
	if db == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainOffer{}, false, ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainOffer{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, ""); err != nil {
		return CaptainOffer{}, false, err
	}
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "reassign")
	if err != nil {
		return CaptainOffer{}, false, err
	}
	if replay != nil {
		offer, err := readCaptainOfferTx(ctx, tx, "offer.id=$1", replay.OfferID)
		if err != nil {
			return CaptainOffer{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return CaptainOffer{}, false, err
		}
		return offer, true, nil
	}
	var state, paymentState, fulfillmentMode string
	var paymentIntentID sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT state,payment_intent_id,payment_state,fulfillment_mode FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&state, &paymentIntentID, &paymentState, &fulfillmentMode); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrOrderNotFound
	} else if err != nil {
		return CaptainOffer{}, false, err
	}
	if fulfillmentMode != FulfillmentModeBthwaniCaptain {
		return CaptainOffer{}, false, ErrCaptainDispatchConflict
	}
	if state != "READY_FOR_DISPATCH" && state != "CAPTAIN_ASSIGNED" {
		return CaptainOffer{}, false, ErrCaptainCustodyConflict
	}
	var currentAssignmentID, oldCaptain, assignmentState string
	err = tx.QueryRowContext(ctx, "SELECT id,captain_actor_id,state FROM dsh.captain_assignments WHERE order_id=$1 AND state IN ('assigned','in_custody') FOR UPDATE", orderID).Scan(&currentAssignmentID, &oldCaptain, &assignmentState)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, err
	}
	if assignmentState == "in_custody" {
		return CaptainOffer{}, false, ErrCaptainCustodyConflict
	}
	if state == "CAPTAIN_ASSIGNED" && currentAssignmentID == "" {
		return CaptainOffer{}, false, ErrCaptainAssignmentConflict
	}
	// A previous parallel batch may contain three active offers, not one.
	if oldCaptain == "" {
		err := tx.QueryRowContext(ctx, "SELECT captain_actor_id FROM dsh.captain_dispatch_offers WHERE order_id=$1 AND state='offered' ORDER BY created_at,id LIMIT 1", orderID).Scan(&oldCaptain)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return CaptainOffer{}, false, err
		}
	}
	if currentAssignmentID != "" {
		if paymentState != "REQUIRES_COLLECTION" || !paymentIntentID.Valid {
			return CaptainOffer{}, false, ErrPaymentStateConflict
		}
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.captain_assignments SET state='reassigned',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='assigned'", currentAssignmentID); err != nil {
			return CaptainOffer{}, false, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.captain_handoffs SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE assignment_id=$1", currentAssignmentID); err != nil {
			return CaptainOffer{}, false, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state='READY_FOR_DISPATCH',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='CAPTAIN_ASSIGNED'", orderID); err != nil {
			return CaptainOffer{}, false, err
		}
		if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: currentAssignmentID, OrderID: orderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: oldCaptain, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
			return CaptainOffer{}, false, err
		}
	}
	// Invalidate every previous offer before selecting the next group.
	if err := supersedePendingCaptainOffersTx(ctx, tx, orderID, "", actingActorID, correlationID); err != nil {
		return CaptainOffer{}, false, err
	}
	if currentAssignmentID != "" {
		if err := restoreCaptainAvailabilityTx(ctx, tx, oldCaptain, idempotencyKey+":restore", requestHash, actingActorID, correlationID); err != nil {
			return CaptainOffer{}, false, err
		}
	}
	offerID, err := dispatchCaptainCandidatesTx(ctx, tx, orderID, oldCaptain, idempotencyKey, requestHash, actingActorID, correlationID, "captain_assignment_reassigned", state, approvedCaptainIDs)
	if err != nil {
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,'reassign',$3,$4,1)`, idempotencyKey, requestHash, orderID, offerID); err != nil {
		return CaptainOffer{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainOffer{}, false, err
	}
	offer, err := ReadCaptainOffer(ctx, db, offerID)
	return offer, false, err
}

func ConfirmStoreHandoff(ctx context.Context, db *sql.DB, orderID, storeID, assignmentID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAssignment, bool, error) {
	if db == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(storeID) == "" || strings.TrimSpace(assignmentID) == "" || expectedVersion < 1 {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "store_confirm")
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	if replay != nil {
		if replay.OrderID != orderID || replay.AssignmentID != assignmentID {
			return CaptainAssignment{}, false, ErrCaptainOperationConflict
		}
		assignment, readErr := readCaptainAssignmentTx(ctx, tx, "id=$1", replay.AssignmentID)
		if readErr != nil {
			return CaptainAssignment{}, false, readErr
		}
		if assignment.OrderID != orderID || assignment.Handoff.StoreID != storeID {
			return CaptainAssignment{}, false, ErrCaptainOperationConflict
		}
		if err := tx.Commit(); err != nil {
			return CaptainAssignment{}, false, err
		}
		return assignment, true, nil
	}
	assignment, err := readCaptainAssignmentTx(ctx, tx, "id=$1", assignmentID)
	if errors.Is(err, ErrCaptainAssignmentNotFound) {
		return CaptainAssignment{}, false, err
	}
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	if assignment.OrderID != orderID || assignment.State != "assigned" || assignment.Handoff.StoreID != storeID || assignment.Handoff.State != "pending" {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	if assignment.Handoff.Version != expectedVersion {
		return CaptainAssignment{}, false, ErrCaptainVersionConflict
	}
	var confirmedAt time.Time
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_handoffs SET state='store_confirmed',store_confirmed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE assignment_id=$1 AND version=$2 RETURNING store_confirmed_at`, assignmentID, expectedVersion).Scan(&confirmedAt); err != nil {
		return CaptainAssignment{}, false, err
	}
	assignment.Handoff.State = "store_confirmed"
	assignment.Handoff.StoreConfirmedAt = &confirmedAt
	assignment.Handoff.Version++
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,assignment_id,result_version) VALUES($1,$2,'store_confirm',$3,$4,$5)`, idempotencyKey, requestHash, orderID, assignmentID, assignment.Handoff.Version); err != nil {
		return CaptainAssignment{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,assignment_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('store_handoff_confirmed',$1,$2,$3,$4,$5,$6,'pending','store_confirmed',$7,$8)`, idempotencyKey, correlationID, actingActorID, orderID, assignmentID, assignment.CaptainActorID, assignment.Handoff.Version, requestHash); err != nil {
		return CaptainAssignment{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAssignment{}, false, err
	}
	assignment, err = ReadCaptainAssignment(ctx, db, assignmentID)
	return assignment, false, err
}

func CompleteCaptainPickup(ctx context.Context, db *sql.DB, assignmentID, captainActorID string, expectedVersion int, idempotencyKey, requestHash, correlationID string) (CaptainAssignment, bool, error) {
	if db == nil || strings.TrimSpace(assignmentID) == "" || strings.TrimSpace(captainActorID) == "" || expectedVersion < 1 {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "pickup")
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	if replay != nil {
		if replay.AssignmentID != assignmentID {
			return CaptainAssignment{}, false, ErrCaptainOperationConflict
		}
		assignment, readErr := readCaptainAssignmentTx(ctx, tx, "id=$1", replay.AssignmentID)
		if readErr != nil {
			return CaptainAssignment{}, false, readErr
		}
		if assignment.CaptainActorID != captainActorID {
			return CaptainAssignment{}, false, ErrCaptainOfferForbidden
		}
		if err := tx.Commit(); err != nil {
			return CaptainAssignment{}, false, err
		}
		return assignment, true, nil
	}
	assignment, err := readCaptainAssignmentTx(ctx, tx, "id=$1", assignmentID)
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	if assignment.CaptainActorID != captainActorID {
		return CaptainAssignment{}, false, ErrCaptainOfferForbidden
	}
	if assignment.State != "assigned" || assignment.Handoff.State != "store_confirmed" || assignment.Handoff.Version != expectedVersion {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	if err := requireCaptainGoodsCustodyLimitTx(ctx, tx, assignment.OrderID, captainActorID); err != nil {
		return CaptainAssignment{}, false, err
	}
	var pickedUpAt time.Time
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_handoffs SET state='completed',captain_picked_up_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE assignment_id=$1 AND version=$2 AND state='store_confirmed' RETURNING captain_picked_up_at`, assignmentID, expectedVersion).Scan(&pickedUpAt); err != nil {
		return CaptainAssignment{}, false, err
	}
	var orderID string
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_assignments SET state='in_custody',custody_started_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='assigned' RETURNING order_id`, assignmentID).Scan(&orderID); err != nil {
		return CaptainAssignment{}, false, err
	}
	if result, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state='IN_CUSTODY',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='CAPTAIN_ASSIGNED'", orderID); err != nil {
		return CaptainAssignment{}, false, err
	} else if rows, err := result.RowsAffected(); err != nil {
		return CaptainAssignment{}, false, err
	} else if rows != 1 {
		return CaptainAssignment{}, false, ErrCaptainAssignmentConflict
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,assignment_id,result_version) VALUES($1,$2,'pickup',$3,$4,$5)`, idempotencyKey, requestHash, orderID, assignmentID, assignment.Version+1); err != nil {
		return CaptainAssignment{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,assignment_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('captain_pickup_completed',$1,$2,$3,$4,$5,$6,'assigned','in_custody',$7,$8)`, idempotencyKey, correlationID, captainActorID, orderID, assignmentID, captainActorID, assignment.Version+1, requestHash); err != nil {
		return CaptainAssignment{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAssignment{}, false, err
	}
	assignment, err = ReadCaptainAssignment(ctx, db, assignmentID)
	return assignment, false, err
}

func CompleteCaptainAssignment(ctx context.Context, db *sql.DB, assignmentID, captainActorID, result string, collectedAmountMinor int64, deliveryProofCode string, expectedVersion int, idempotencyKey, correlationID string, keys *DeliveryProofKeyring) (CaptainAssignment, bool, error) {
	submittedResult := strings.TrimSpace(result)
	result = strings.ToLower(submittedResult)
	deliveryProofCode = strings.TrimSpace(deliveryProofCode)
	if result != "delivered" && result != "delivery_failed" {
		return CaptainAssignment{}, false, ErrCaptainTerminalConflict
	}
	if collectedAmountMinor < 0 || (result != "delivered" && collectedAmountMinor != 0) {
		return CaptainAssignment{}, false, ErrPaymentStateConflict
	}
	if db == nil || keys == nil || strings.TrimSpace(assignmentID) == "" || strings.TrimSpace(captainActorID) == "" || expectedVersion < 1 {
		return CaptainAssignment{}, false, ErrCaptainTerminalConflict
	}
	requestFacts := []string{assignmentID, result, strconv.FormatInt(collectedAmountMinor, 10), deliveryProofCode, strconv.Itoa(expectedVersion)}
	requestHash, err := keys.ActiveIdempotencyHash("captain-completion", requestFacts...)
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "complete", func(stored string) bool {
		return captainCompletionReplayHashMatches(keys, stored, requestFacts, assignmentID, submittedResult, collectedAmountMinor, deliveryProofCode, expectedVersion)
	})
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	if replay != nil {
		assignment, readErr := readCaptainAssignmentTx(ctx, tx, "id=$1", replay.AssignmentID)
		if readErr != nil {
			return CaptainAssignment{}, false, readErr
		}
		if replay.AssignmentID != assignmentID || assignment.CaptainActorID != captainActorID {
			return CaptainAssignment{}, false, ErrCaptainOfferForbidden
		}
		if err := tx.Commit(); err != nil {
			return CaptainAssignment{}, false, err
		}
		return assignment, true, nil
	}
	assignment, err := readCaptainAssignmentTx(ctx, tx, "id=$1", assignmentID)
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	if assignment.CaptainActorID != captainActorID {
		return CaptainAssignment{}, false, ErrCaptainOfferForbidden
	}
	if assignment.State != "in_custody" || assignment.Version != expectedVersion || assignment.Handoff.State != "completed" {
		return CaptainAssignment{}, false, ErrCaptainTerminalConflict
	}
	if (result == "delivered" && deliveryProofCode != "" && !validDeliveryProofCode(deliveryProofCode)) || (result == "delivery_failed" && deliveryProofCode != "") {
		return CaptainAssignment{}, false, ErrDeliveryProofInvalid
	}
	var orderID string
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_assignments SET state=$2,terminal_result=$3,terminal_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='in_custody' AND version=$4 RETURNING order_id`, assignmentID, result, result, expectedVersion).Scan(&orderID); err != nil {
		return CaptainAssignment{}, false, err
	}
	if result == "delivered" {
		var proofHash, proofState, proofKeyID, proofType string
		if err := tx.QueryRowContext(ctx, `SELECT code_verifier,state,code_key_id,proof_type FROM dsh.commerce_order_delivery_proofs WHERE order_id=$1 FOR UPDATE`, orderID).Scan(&proofHash, &proofState, &proofKeyID, &proofType); errors.Is(err, sql.ErrNoRows) {
			return CaptainAssignment{}, false, ErrDeliveryProofInvalid
		} else if err != nil {
			return CaptainAssignment{}, false, err
		}
		if proofType != "DELIVERY" || proofState != "PENDING" {
			return CaptainAssignment{}, false, ErrDeliveryProofInvalid
		}
		proofResult := "CAPTAIN_CONFIRMED"
		if deliveryProofCode != "" {
			if !keys.VerifyProof(orderID, proofKeyID, proofHash, deliveryProofCode) {
				return CaptainAssignment{}, false, ErrDeliveryProofInvalid
			}
			proofResult = "VERIFIED"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_delivery_proofs SET state=$3,code_ciphertext=NULL,code_verifier=NULL,code_key_id=NULL,verified_by=$2,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE order_id=$1 AND state='PENDING'`, orderID, captainActorID, proofResult); err != nil {
			return CaptainAssignment{}, false, err
		}
	}
	var paymentIntentID sql.NullString
	var paymentCashAmount int64
	var currentPaymentState, storeID, fulfillmentMode, paymentMethod string
	if err := tx.QueryRowContext(ctx, "SELECT payment_intent_id,payment_cash_amount_minor,payment_state,store_id,fulfillment_mode,payment_method FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&paymentIntentID, &paymentCashAmount, &currentPaymentState, &storeID, &fulfillmentMode, &paymentMethod); err != nil {
		return CaptainAssignment{}, false, err
	}
	orderState := "DELIVERED"
	if result == "delivery_failed" {
		orderState = "DELIVERY_FAILED"
	}
	if result == "delivered" {
		switch fulfillmentMode {
		case FulfillmentModeBthwaniCaptain:
			switch currentPaymentState {
			case "REQUIRES_COLLECTION":
				if !paymentIntentID.Valid {
					return CaptainAssignment{}, false, ErrPaymentStateConflict
				}
				if collectedAmountMinor != 0 && collectedAmountMinor != paymentCashAmount {
					return CaptainAssignment{}, false, ErrCaptainCollectedAmountMismatch
				}
				var partnerActorID string
				if err := tx.QueryRowContext(ctx, "SELECT partner_actor_id FROM dsh.stores WHERE id=$1", storeID).Scan(&partnerActorID); err != nil {
					return CaptainAssignment{}, false, err
				}
				if strings.TrimSpace(partnerActorID) == "" {
					return CaptainAssignment{}, false, ErrPaymentStateConflict
				}
				if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "DELIVERY_SETTLEMENT", SourceRef: assignmentID, OrderID: orderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: captainActorID, PartnerActorID: partnerActorID, AmountMinor: paymentCashAmount, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: captainActorID}); err != nil {
					return CaptainAssignment{}, false, err
				}
			case "COLLECTED":
				if collectedAmountMinor != 0 && collectedAmountMinor != paymentCashAmount {
					return CaptainAssignment{}, false, ErrCaptainCollectedAmountMismatch
				}
			default:
				return CaptainAssignment{}, false, ErrPaymentStateConflict
			}
		case FulfillmentModePartnerCaptain:
			if paymentMethod != "CASH_AT_STORE" {
				return CaptainAssignment{}, false, ErrPaymentStateConflict
			}
			if currentPaymentState != "REQUIRES_COLLECTION" || !paymentIntentID.Valid {
				return CaptainAssignment{}, false, ErrPaymentStateConflict
			}
			if collectedAmountMinor != 0 && collectedAmountMinor != paymentCashAmount {
				return CaptainAssignment{}, false, ErrCaptainCollectedAmountMismatch
			}
			var partnerActorID string
			if err := tx.QueryRowContext(ctx, "SELECT partner_actor_id FROM dsh.stores WHERE id=$1 FOR SHARE", storeID).Scan(&partnerActorID); err != nil {
				return CaptainAssignment{}, false, err
			}
			if strings.TrimSpace(partnerActorID) == "" {
				return CaptainAssignment{}, false, ErrPaymentStateConflict
			}
			if paymentCashAmount == 0 {
				if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "PARTNER_CAPTAIN_BALANCE_SETTLEMENT", SourceRef: assignmentID, OrderID: orderID, PaymentIntentID: paymentIntentID.String, PartnerActorID: partnerActorID, AmountMinor: 0, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: captainActorID}); err != nil {
					return CaptainAssignment{}, false, err
				}
			} else if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_store_cash_handoffs(order_id,assignment_id,store_id,captain_actor_id,partner_actor_id,amount_minor,completion_idempotency_key)
				VALUES($1,$2,$3,$4,$5,$6,$7)`, orderID, assignmentID, storeID, captainActorID, partnerActorID, paymentCashAmount, idempotencyKey); err != nil {
				return CaptainAssignment{}, false, fmt.Errorf("record Store Captain cash custody: %w", err)
			}
		default:
			return CaptainAssignment{}, false, ErrOrderStateConflict
		}
	}
	if result, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='IN_CUSTODY'", orderID, orderState); err != nil {
		return CaptainAssignment{}, false, err
	} else if rows, err := result.RowsAffected(); err != nil {
		return CaptainAssignment{}, false, err
	} else if rows != 1 {
		return CaptainAssignment{}, false, ErrCaptainTerminalConflict
	}
	if result == "delivered" {
		if err := consumeOrderInventoryTx(ctx, tx, orderID); err != nil {
			return CaptainAssignment{}, false, err
		}
		// Completion closes the assignment only. Dispatch availability is the
		// Captain's explicit decision, not a side effect of delivery settlement.
		// Re-enabling automatically here can issue a new offer before the Captain
		// is safely stopped, and invalidates the UI's versioned availability switch.
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,assignment_id,result_version) VALUES($1,$2,'complete',$3,$4,$5)`, idempotencyKey, requestHash, orderID, assignmentID, assignment.Version+1); err != nil {
		return CaptainAssignment{}, false, err
	}
	auditEvent := "delivery_completed"
	if result == "delivery_failed" {
		auditEvent = "delivery_failed"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,assignment_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,'in_custody',$8,$9,$10)`, auditEvent, idempotencyKey, correlationID, captainActorID, orderID, assignmentID, captainActorID, orderState, assignment.Version+1, requestHash); err != nil {
		return CaptainAssignment{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAssignment{}, false, err
	}
	assignment, err = ReadCaptainAssignment(ctx, db, assignmentID)
	return assignment, false, err
}

func RecoverCaptainAssignment(ctx context.Context, db *sql.DB, assignmentID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAssignment, bool, error) {
	if db == nil || strings.TrimSpace(assignmentID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAssignment{}, false, ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "recover")
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	if replay != nil {
		assignment, readErr := readCaptainAssignmentTx(ctx, tx, "id=$1", replay.AssignmentID)
		if readErr != nil {
			return CaptainAssignment{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAssignment{}, false, err
		}
		return assignment, true, nil
	}
	var orderID, captainActorID, assignmentState, handoffState, fulfillmentMode string
	var version int
	err = tx.QueryRowContext(ctx, `SELECT a.order_id,a.captain_actor_id,a.state,a.version,h.state,o.fulfillment_mode
		FROM dsh.captain_assignments a
		JOIN dsh.captain_handoffs h ON h.assignment_id=a.id
		JOIN dsh.commerce_orders o ON o.id=a.order_id
		WHERE a.id=$1
		FOR UPDATE OF a,h`, strings.TrimSpace(assignmentID)).Scan(&orderID, &captainActorID, &assignmentState, &version, &handoffState, &fulfillmentMode)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, false, ErrCaptainAssignmentNotFound
	}
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	if assignmentState != "delivery_failed" || version != expectedVersion || handoffState != "completed" {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	var orderState string
	if err := tx.QueryRowContext(ctx, `SELECT state FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&orderState); errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, false, ErrOrderNotFound
	} else if err != nil {
		return CaptainAssignment{}, false, err
	}
	if orderState != "DELIVERY_FAILED" {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	var hasOtherActiveAssignment bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND id<>$2 AND state IN ('assigned','in_custody'))`, captainActorID, assignmentID).Scan(&hasOtherActiveAssignment); err != nil {
		return CaptainAssignment{}, false, err
	}
	if hasOtherActiveAssignment {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	if fulfillmentMode == FulfillmentModeBthwaniCaptain {
		var admissionID, admissionState, availabilityState string
		var admissionVersion int
		if err := tx.QueryRowContext(ctx, `SELECT id,state,availability_state,version FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, captainActorID).Scan(&admissionID, &admissionState, &availabilityState, &admissionVersion); errors.Is(err, sql.ErrNoRows) {
			return CaptainAssignment{}, false, ErrCaptainNotEligible
		} else if err != nil {
			return CaptainAssignment{}, false, err
		}
		if admissionState != "eligible" {
			return CaptainAssignment{}, false, ErrCaptainCustodyConflict
		}
		if availabilityState == "available" {
			if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND availability_state='available' RETURNING version`, admissionID).Scan(&admissionVersion); err != nil {
				return CaptainAssignment{}, false, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,'available','unavailable',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, captainActorID, admissionVersion-1, admissionVersion, requestHash); err != nil {
				return CaptainAssignment{}, false, err
			}
		} else if availabilityState != "unavailable" {
			return CaptainAssignment{}, false, ErrCaptainCustodyConflict
		}
	} else if fulfillmentMode != FulfillmentModePartnerCaptain {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	var updatedVersion int
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_assignments SET state='in_custody',terminal_result=NULL,terminal_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='delivery_failed' AND version=$2 RETURNING version`, assignmentID, expectedVersion).Scan(&updatedVersion); err != nil {
		return CaptainAssignment{}, false, err
	}
	if result, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_orders SET state='IN_CUSTODY',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='DELIVERY_FAILED'`, orderID); err != nil {
		return CaptainAssignment{}, false, err
	} else if rows, err := result.RowsAffected(); err != nil {
		return CaptainAssignment{}, false, err
	} else if rows != 1 {
		return CaptainAssignment{}, false, ErrCaptainCustodyConflict
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,assignment_id,result_version) VALUES($1,$2,'recover',$3,$4,$5)`, idempotencyKey, requestHash, orderID, assignmentID, updatedVersion); err != nil {
		return CaptainAssignment{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,assignment_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('delivery_recovered',$1,$2,$3,$4,$5,$6,'delivery_failed','in_custody',$7,$8)`, idempotencyKey, correlationID, actingActorID, orderID, assignmentID, captainActorID, updatedVersion, requestHash); err != nil {
		return CaptainAssignment{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAssignment{}, false, err
	}
	assignment, err := ReadCaptainAssignment(ctx, db, assignmentID)
	return assignment, false, err
}
