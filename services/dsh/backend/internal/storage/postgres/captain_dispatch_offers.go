package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/lib/pq"
	"strconv"
	"strings"
	"time"
)

func CreateCaptainDispatchOffer(ctx context.Context, db *sql.DB, orderID, idempotencyKey, requestHash, actingActorID, correlationID string, approvedCaptainIDs ...string) (CaptainOffer, bool, error) {
	return createCaptainDispatchOffer(ctx, db, orderID, "", idempotencyKey, requestHash, actingActorID, correlationID, "dispatch", approvedCaptainIDs)
}

func CreateStoreCaptainDispatchOffer(ctx context.Context, db *sql.DB, storeID, orderID, captainActorID, partnerActorID string, expectedOrderVersion int, idempotencyKey, requestHash, correlationID string) (CaptainOffer, bool, error) {
	storeID, orderID, captainActorID = strings.TrimSpace(storeID), strings.TrimSpace(orderID), strings.TrimSpace(captainActorID)
	partnerActorID, idempotencyKey, requestHash, correlationID = strings.TrimSpace(partnerActorID), strings.TrimSpace(idempotencyKey), strings.TrimSpace(requestHash), strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || orderID == "" || captainActorID == "" || partnerActorID == "" || expectedOrderVersion < 1 || idempotencyKey == "" || requestHash == "" || correlationID == "" {
		return CaptainOffer{}, false, ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainOffer{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, captainActorID); err != nil {
		return CaptainOffer{}, false, err
	}
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "store_dispatch")
	if err != nil {
		return CaptainOffer{}, false, err
	}
	if replay != nil {
		offer, readErr := readCaptainOfferTx(ctx, tx, "offer.id=$1 AND offer.source_store_id=$2", replay.OfferID, storeID)
		if readErr != nil {
			return CaptainOffer{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainOffer{}, false, err
		}
		return offer, true, nil
	}
	var orderState, fulfillmentMode, orderStoreID, ownerActorID string
	var orderVersion int
	err = tx.QueryRowContext(ctx, `SELECT o.state,o.version,o.fulfillment_mode,o.store_id,s.partner_actor_id
		FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id
		WHERE o.id=$1 FOR UPDATE OF o`, orderID).Scan(&orderState, &orderVersion, &fulfillmentMode, &orderStoreID, &ownerActorID)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrOrderNotFound
	}
	if err != nil {
		return CaptainOffer{}, false, err
	}
	if orderStoreID != storeID || (ownerActorID != partnerActorID && !storeGrantHoldsPermissionTx(ctx, tx, storeID, partnerActorID, "fulfillment")) {
		return CaptainOffer{}, false, ErrOrderNotFound
	}
	if fulfillmentMode != FulfillmentModePartnerCaptain || orderState != "READY_FOR_DISPATCH" {
		return CaptainOffer{}, false, ErrCaptainDispatchConflict
	}
	if orderVersion != expectedOrderVersion {
		return CaptainOffer{}, false, ErrOrderVersionConflict
	}
	var activeOffer bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.captain_dispatch_offers WHERE order_id=$1 AND state='offered')`, orderID).Scan(&activeOffer); err != nil {
		return CaptainOffer{}, false, err
	}
	if activeOffer {
		return CaptainOffer{}, false, ErrCaptainDispatchConflict
	}
	var membershipID string
	var targetedActor sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT id,invited_captain_actor_id FROM dsh.store_captain_memberships WHERE store_id=$1 AND partner_actor_id=$2 AND captain_actor_id=$3 AND state='active' FOR SHARE`, storeID, partnerActorID, captainActorID).Scan(&membershipID, &targetedActor); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrStoreCaptainMembershipNotFound
	} else if err != nil {
		return CaptainOffer{}, false, err
	}
	var admissionState string
	var requiresProfileReview bool
	if err := tx.QueryRowContext(ctx, `SELECT state,requires_profile_review FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, captainActorID).Scan(&admissionState, &requiresProfileReview); errors.Is(err, sql.ErrNoRows) {
		// Store-created, phone-verified Captains are not admitted into the public pool.
		if !targetedActor.Valid || targetedActor.String != captainActorID {
			return CaptainOffer{}, false, ErrCaptainNotEligible
		}
	} else if err != nil {
		return CaptainOffer{}, false, err
	} else if admissionState != "eligible" || requiresProfileReview {
		return CaptainOffer{}, false, ErrCaptainNotEligible
	}
	var captainHasActiveWork bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered') OR EXISTS(SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody','delivery_failed'))`, captainActorID).Scan(&captainHasActiveWork); err != nil {
		return CaptainOffer{}, false, err
	}
	if captainHasActiveWork {
		return CaptainOffer{}, false, ErrCaptainNoAvailable
	}
	offerID, err := newID("captain-offer")
	if err != nil {
		return CaptainOffer{}, false, err
	}
	expiresAt := time.Now().UTC().Add(captainOfferTimeout)
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,source_store_id,state,expires_at,version,idempotency_key,request_hash)
		VALUES($1,$2,$3,$4,'offered',$5,1,$6,$7)`, offerID, orderID, captainActorID, storeID, expiresAt, idempotencyKey, requestHash); err != nil {
		if isUniqueViolation(err) {
			return CaptainOffer{}, false, ErrCaptainDispatchConflict
		}
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,'store_dispatch',$3,$4,1)`, idempotencyKey, requestHash, orderID, offerID); err != nil {
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,to_state,result_version,request_hash) VALUES('dispatch_offer_created',$1,$2,$3,$4,$5,$6,'offered',1,$7)`, idempotencyKey, correlationID, partnerActorID, orderID, offerID, captainActorID, requestHash); err != nil {
		return CaptainOffer{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainOffer{}, false, err
	}
	offer, err := ReadCaptainOffer(ctx, db, offerID)
	return offer, false, err
}

func ReadStoreCaptainDispatchOffer(ctx context.Context, db *sql.DB, storeID, orderID, partnerActorID string) (CaptainOffer, error) {
	storeID, orderID, partnerActorID = strings.TrimSpace(storeID), strings.TrimSpace(orderID), strings.TrimSpace(partnerActorID)
	if db == nil || storeID == "" || orderID == "" || partnerActorID == "" {
		return CaptainOffer{}, ErrCaptainOfferNotFound
	}
	var offerID string
	err := db.QueryRowContext(ctx, `SELECT offer.id FROM dsh.captain_dispatch_offers offer
		JOIN dsh.commerce_orders o ON o.id=offer.order_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE offer.source_store_id=$1 AND offer.order_id=$2 AND o.store_id=$1 AND o.fulfillment_mode=$4
		AND (s.partner_actor_id=$3 OR EXISTS(
			SELECT 1 FROM dsh.store_access_grants g
			WHERE g.store_id=s.id AND g.delegate_actor_id=$3
			AND g.state='active' AND 'fulfillment'=ANY(g.permissions)
		))
		ORDER BY offer.created_at DESC,offer.id DESC LIMIT 1`, storeID, orderID, partnerActorID, FulfillmentModePartnerCaptain).Scan(&offerID)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, ErrCaptainOfferNotFound
	}
	if err != nil {
		return CaptainOffer{}, err
	}
	return ReadCaptainOffer(ctx, db, offerID)
}

// dispatchCaptainCandidatesTx creates at most three offers in one order-locked
// transaction. Only BTHWANI_CAPTAIN calls this helper; store Captain is unchanged.
func dispatchCaptainCandidatesTx(ctx context.Context, tx *sql.Tx, orderID, excludeCaptainID, idempotencyKey, requestHash, actingActorID, correlationID, auditEvent, fromState string, approvedCaptainIDs []string) (string, error) {
	query := `SELECT id,actor_id FROM dsh.captain_admissions WHERE state='eligible'
		AND requires_profile_review=false AND availability_state='available'
		AND NOT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers o WHERE o.captain_actor_id=dsh.captain_admissions.actor_id AND o.state='offered')
		AND NOT EXISTS (SELECT 1 FROM dsh.captain_assignments a WHERE a.captain_actor_id=dsh.captain_admissions.actor_id AND a.state IN ('assigned','in_custody'))`
	args := []any{}
	if excludeCaptainID != "" {
		query += " AND actor_id<>$1"
		args = append(args, excludeCaptainID)
	}
	if approvedCaptainIDs != nil {
		query += " AND actor_id = ANY($" + strconv.Itoa(len(args)+1) + "::text[])"
		args = append(args, pq.Array(approvedCaptainIDs))
		query += " ORDER BY array_position($" + strconv.Itoa(len(args)) + "::text[], actor_id), actor_id LIMIT 3 FOR UPDATE SKIP LOCKED"
	} else {
		query += " ORDER BY updated_at,actor_id LIMIT 3 FOR UPDATE SKIP LOCKED"
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return "", err
	}
	type candidate struct{ admissionID, actorID string }
	candidates := make([]candidate, 0, 3)
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.admissionID, &c.actorID); err != nil {
			_ = rows.Close()
			return "", err
		}
		candidates = append(candidates, c)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return "", err
	}
	if err := rows.Close(); err != nil {
		return "", err
	}
	if len(candidates) == 0 {
		return "", ErrCaptainNoAvailable
	}
	var firstID string
	expiresAt := time.Now().UTC().Add(captainOfferTimeout)
	for i, c := range candidates {
		id, err := newID("captain-offer")
		if err != nil {
			return "", err
		}
		key := idempotencyKey
		if i > 0 {
			key = fmt.Sprintf("%s:offer-%d", idempotencyKey, i+1)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,version,idempotency_key,request_hash) VALUES($1,$2,$3,'offered',$4,1,$5,$6)`, id, orderID, c.actorID, expiresAt, key, requestHash); err != nil {
			if isUniqueViolation(err) {
				return "", ErrCaptainDispatchConflict
			}
			return "", err
		}
		if err := reserveCaptainAvailabilityTx(ctx, tx, c.admissionID, c.actorID, key, requestHash, actingActorID, correlationID); err != nil {
			return "", err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),'offered',1,$9)`, auditEvent, key, correlationID, actingActorID, orderID, id, c.actorID, fromState, requestHash); err != nil {
			return "", err
		}
		if i == 0 {
			firstID = id
		}
	}
	return firstID, nil
}

// supersedePendingCaptainOffersTx removes losing offers before restoring
// availability, ensuring their late acceptances cannot assign the order.
func supersedePendingCaptainOffersTx(ctx context.Context, tx *sql.Tx, orderID, winningOfferID, actingActorID, correlationID string) error {
	rows, err := tx.QueryContext(ctx, `SELECT id,captain_actor_id FROM dsh.captain_dispatch_offers WHERE order_id=$1 AND state='offered' AND id<>$2 ORDER BY id FOR UPDATE`, orderID, winningOfferID)
	if err != nil {
		return err
	}
	type loser struct{ id, actorID string }
	losers := make([]loser, 0, 3)
	for rows.Next() {
		var l loser
		if err := rows.Scan(&l.id, &l.actorID); err != nil {
			_ = rows.Close()
			return err
		}
		losers = append(losers, l)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(losers) == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE order_id=$1 AND state='offered' AND id<>$2`, orderID, winningOfferID); err != nil {
		return err
	}
	var paymentIntentID sql.NullString
	var paymentState string
	if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, orderID).Scan(&paymentIntentID, &paymentState); err != nil {
		return err
	}
	for _, l := range losers {
		key := "captain-superseded:" + l.id
		hash := hashFacts("dispatch-offer-superseded", orderID, l.id)
		if err := restoreCaptainAvailabilityTx(ctx, tx, l.actorID, key, hash, actingActorID, correlationID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_superseded',$1,$2,$3,$4,$5,$6,'offered','superseded',2,$7)`, key, correlationID, actingActorID, orderID, l.id, l.actorID, hash); err != nil {
			return err
		}
		if paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: l.id, OrderID: orderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: l.actorID, IdempotencyKey: key, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
				return err
			}
		}
	}
	return nil
}

func createCaptainDispatchOffer(ctx context.Context, db *sql.DB, orderID, excludeCaptainID, idempotencyKey, requestHash, actingActorID, correlationID, operation string, approvedCaptainIDs []string) (CaptainOffer, bool, error) {
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
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, operation)
	if err != nil {
		return CaptainOffer{}, false, err
	}
	if replay != nil {
		offer, readErr := readCaptainOfferTx(ctx, tx, "offer.id=$1", replay.OfferID)
		if readErr != nil {
			return CaptainOffer{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainOffer{}, false, err
		}
		return offer, true, nil
	}
	var state, fulfillmentMode string
	var orderVersion int
	if err := tx.QueryRowContext(ctx, "SELECT state,version,fulfillment_mode FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&state, &orderVersion, &fulfillmentMode); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrOrderNotFound
	} else if err != nil {
		return CaptainOffer{}, false, err
	}
	if state != "READY_FOR_DISPATCH" || fulfillmentMode != FulfillmentModeBthwaniCaptain {
		return CaptainOffer{}, false, ErrCaptainDispatchConflict
	}
	var active string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.captain_dispatch_offers WHERE order_id=$1 AND state='offered' FOR UPDATE", orderID).Scan(&active); err == nil {
		return CaptainOffer{}, false, ErrCaptainDispatchConflict
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, err
	}
	offerID, err := dispatchCaptainCandidatesTx(ctx, tx, orderID, excludeCaptainID, idempotencyKey, requestHash, actingActorID, correlationID, "dispatch_offer_created", "", approvedCaptainIDs)
	if err != nil {
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,$3,$4,$5,1)`, idempotencyKey, requestHash, operation, orderID, offerID); err != nil {
		return CaptainOffer{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainOffer{}, false, err
	}
	offer, err := ReadCaptainOffer(ctx, db, offerID)
	return offer, false, err
}

func ReadCaptainOffer(ctx context.Context, db *sql.DB, offerID string) (CaptainOffer, error) {
	if db == nil || strings.TrimSpace(offerID) == "" {
		return CaptainOffer{}, ErrCaptainOfferNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainOffer{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var actorID string
	if err := tx.QueryRowContext(ctx, `SELECT captain_actor_id FROM dsh.captain_dispatch_offers WHERE id=$1`, strings.TrimSpace(offerID)).Scan(&actorID); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, ErrCaptainOfferNotFound
	} else if err != nil {
		return CaptainOffer{}, err
	}
	if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
		return CaptainOffer{}, err
	}
	offer, err := readCaptainOfferTx(ctx, tx, "offer.id=$1", strings.TrimSpace(offerID))
	if err != nil {
		return CaptainOffer{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainOffer{}, err
	}
	return offer, nil
}

func ListCaptainOffers(ctx context.Context, db *sql.DB, actorID string, limit int) ([]CaptainOffer, error) {
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
	rows, err := tx.QueryContext(ctx, `SELECT offer.id,offer.order_id,offer.captain_actor_id,COALESCE(offer.source_store_id,''),offer.state,offer.expires_at,offer.version,offer.created_at,offer.updated_at,s.name,COALESCE((SELECT uri FROM dsh.store_profile_media_assets m WHERE m.store_id=s.id AND m.state='active' AND m.rights_attested_at IS NOT NULL LIMIT 1),''),COALESCE((SELECT NULLIF(city.display_name_ar,'') FROM dsh.service_cities city WHERE city.id=o.service_city_id),'منطقة الخدمة'),o.payment_cash_amount_minor,o.currency,o.payment_method,o.payment_state
		FROM dsh.captain_dispatch_offers offer
		JOIN dsh.commerce_orders o ON o.id=offer.order_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE offer.captain_actor_id=$1 AND offer.state<>'superseded'
		ORDER BY offer.created_at DESC,offer.id DESC LIMIT $2`, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CaptainOffer, 0)
	for rows.Next() {
		var item CaptainOffer
		if err := rows.Scan(&item.ID, &item.OrderID, &item.CaptainActorID, &item.SourceStoreID, &item.State, &item.ExpiresAt, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.StoreName, &item.StoreProfileImageURI, &item.DeliveryAreaText, &item.AmountDueMinor, &item.Currency, &item.PaymentMethod, &item.PaymentState); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return items, nil
}

func RespondToCaptainOffer(ctx context.Context, db *sql.DB, offerID, captainActorID, decision string, expectedVersion int, idempotencyKey, requestHash, correlationID string) (CaptainOfferResult, error) {
	decision = strings.ToLower(strings.TrimSpace(decision))
	if db == nil || strings.TrimSpace(offerID) == "" || strings.TrimSpace(captainActorID) == "" || (decision != "accept" && decision != "reject") || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainOfferResult{}, ErrCaptainOfferConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainOfferResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, ""); err != nil {
		return CaptainOfferResult{}, err
	}
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "respond_offer")
	if err != nil {
		return CaptainOfferResult{}, err
	}
	if replay != nil {
		if replay.OfferID != offerID {
			return CaptainOfferResult{}, ErrCaptainOperationConflict
		}
		offer, readErr := readCaptainOfferTx(ctx, tx, "offer.id=$1", offerID)
		if readErr != nil {
			return CaptainOfferResult{}, readErr
		}
		if offer.CaptainActorID != captainActorID {
			return CaptainOfferResult{}, ErrCaptainOfferForbidden
		}
		if offer.State == "expired" {
			return CaptainOfferResult{Offer: offer, Replayed: true}, ErrCaptainOfferExpired
		}
		var assignment *CaptainAssignment
		if replay.AssignmentID != "" {
			value, assignmentErr := readCaptainAssignmentTx(ctx, tx, "id=$1", replay.AssignmentID)
			if assignmentErr != nil {
				return CaptainOfferResult{}, assignmentErr
			}
			assignment = &value
		}
		if err := tx.Commit(); err != nil {
			return CaptainOfferResult{}, err
		}
		return CaptainOfferResult{Offer: offer, Assignment: assignment, Replayed: true}, nil
	}
	// Every captain acceptance must lock the order before its offer. Otherwise
	// simultaneous acceptances could deadlock while superseding other offers.
	var lockedOrderID string
	if err := tx.QueryRowContext(ctx, `SELECT o.id FROM dsh.commerce_orders o
		JOIN dsh.captain_dispatch_offers offer ON offer.order_id=o.id
		WHERE offer.id=$1 FOR UPDATE OF o`, offerID).Scan(&lockedOrderID); errors.Is(err, sql.ErrNoRows) {
		return CaptainOfferResult{}, ErrCaptainOfferNotFound
	} else if err != nil {
		return CaptainOfferResult{}, err
	}
	var offer CaptainOffer
	err = tx.QueryRowContext(ctx, `SELECT offer.id,offer.order_id,offer.captain_actor_id,COALESCE(offer.source_store_id,''),offer.state,offer.expires_at,offer.version,offer.created_at,offer.updated_at,s.name,COALESCE((SELECT uri FROM dsh.store_profile_media_assets m WHERE m.store_id=s.id AND m.state='active' AND m.rights_attested_at IS NOT NULL LIMIT 1),''),COALESCE((SELECT NULLIF(city.display_name_ar,'') FROM dsh.service_cities city WHERE city.id=o.service_city_id),'منطقة الخدمة'),o.payment_cash_amount_minor,o.currency,o.payment_method,o.payment_state
		FROM dsh.captain_dispatch_offers offer
		JOIN dsh.commerce_orders o ON o.id=offer.order_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE offer.id=$1 FOR UPDATE OF offer`, offerID).Scan(&offer.ID, &offer.OrderID, &offer.CaptainActorID, &offer.SourceStoreID, &offer.State, &offer.ExpiresAt, &offer.Version, &offer.CreatedAt, &offer.UpdatedAt, &offer.StoreName, &offer.StoreProfileImageURI, &offer.DeliveryAreaText, &offer.AmountDueMinor, &offer.Currency, &offer.PaymentMethod, &offer.PaymentState)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainOfferResult{}, ErrCaptainOfferNotFound
	}
	if err != nil {
		return CaptainOfferResult{}, err
	}
	if offer.CaptainActorID != captainActorID {
		return CaptainOfferResult{}, ErrCaptainOfferForbidden
	}
	if offer.State == "expired" || (offer.State == "offered" && !time.Now().UTC().Before(offer.ExpiresAt)) {
		if offer.State == "offered" {
			var expiredVersion int
			if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='expired',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='offered' AND version=$2 RETURNING version`, offer.ID, offer.Version).Scan(&expiredVersion); err != nil {
				return CaptainOfferResult{}, err
			}
			key := "captain-timeout:" + offer.ID
			hash := hashFacts("captain-offer-expired", offer.ID)
			if offer.SourceStoreID == "" {
				if err := restoreCaptainAvailabilityTx(ctx, tx, offer.CaptainActorID, key, hash, "system:captain-timeout", key); err != nil {
					return CaptainOfferResult{}, err
				}
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_expired',$1,$2,$3,$4,$5,$6,'offered','expired',$7,$8) ON CONFLICT (event_type,idempotency_key) DO NOTHING`, key, key, "system:captain-timeout", offer.OrderID, offer.ID, offer.CaptainActorID, expiredVersion, hash); err != nil {
				return CaptainOfferResult{}, err
			}
			var paymentIntentID sql.NullString
			var paymentState string
			if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, offer.OrderID).Scan(&paymentIntentID, &paymentState); err != nil {
				return CaptainOfferResult{}, err
			}
			if offer.SourceStoreID == "" && paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
				if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: offer.ID, OrderID: offer.OrderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: offer.CaptainActorID, IdempotencyKey: key, CorrelationID: key, ActingActorID: "system:captain-timeout"}); err != nil {
					return CaptainOfferResult{}, err
				}
			}
			offer.State = "expired"
			offer.Version = expiredVersion
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,'respond_offer',$3,$4,$5)`, idempotencyKey, requestHash, offer.OrderID, offer.ID, offer.Version); err != nil {
			return CaptainOfferResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return CaptainOfferResult{}, err
		}
		return CaptainOfferResult{}, ErrCaptainOfferExpired
	}
	if offer.Version != expectedVersion {
		return CaptainOfferResult{}, ErrCaptainVersionConflict
	}
	if offer.State != "offered" {
		return CaptainOfferResult{}, ErrCaptainOfferConflict
	}
	if decision == "reject" {
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='rejected',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2`, offer.ID, offer.Version); err != nil {
			return CaptainOfferResult{}, err
		}
		offer.State = "rejected"
		offer.Version++
		if offer.SourceStoreID == "" {
			if err := restoreCaptainAvailabilityTx(ctx, tx, captainActorID, idempotencyKey, requestHash, captainActorID, correlationID); err != nil {
				return CaptainOfferResult{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,'respond_offer',$3,$4,$5)`, idempotencyKey, requestHash, offer.OrderID, offer.ID, offer.Version); err != nil {
			return CaptainOfferResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_rejected',$1,$2,$3,$4,$5,$6,'offered','rejected',$7,$8)`, idempotencyKey, correlationID, captainActorID, offer.OrderID, offer.ID, captainActorID, offer.Version, requestHash); err != nil {
			return CaptainOfferResult{}, err
		}
		var paymentIntentID sql.NullString
		var paymentState string
		if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, offer.OrderID).Scan(&paymentIntentID, &paymentState); err != nil {
			return CaptainOfferResult{}, err
		}
		if offer.SourceStoreID == "" && paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: offer.ID, OrderID: offer.OrderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: captainActorID, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: captainActorID}); err != nil {
				return CaptainOfferResult{}, err
			}
		}
		if err := tx.Commit(); err != nil {
			return CaptainOfferResult{}, err
		}
		return CaptainOfferResult{Offer: offer}, nil
	}
	var admissionID, admissionState, admissionAvailability string
	var requiresProfileReview bool
	var targetedMembership bool
	if offer.SourceStoreID != "" {
		var invited sql.NullString
		err := tx.QueryRowContext(ctx, "SELECT invited_captain_actor_id FROM dsh.store_captain_memberships WHERE store_id=$1 AND captain_actor_id=$2 AND state='active' FOR SHARE", offer.SourceStoreID, captainActorID).Scan(&invited)
		if err != nil {
			return CaptainOfferResult{}, ErrCaptainNotEligible
		}
		targetedMembership = invited.Valid && invited.String == captainActorID
	}
	if err := tx.QueryRowContext(ctx, "SELECT id,state,availability_state,requires_profile_review FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE", captainActorID).Scan(&admissionID, &admissionState, &admissionAvailability, &requiresProfileReview); errors.Is(err, sql.ErrNoRows) {
		if !targetedMembership {
			return CaptainOfferResult{}, ErrCaptainNotEligible
		}
	} else if err != nil {
		return CaptainOfferResult{}, err
	} else if admissionState != "eligible" || requiresProfileReview {
		return CaptainOfferResult{}, ErrCaptainNotEligible
	}
	var orderState, orderMode, orderStoreID string
	if err := tx.QueryRowContext(ctx, "SELECT state,fulfillment_mode,store_id FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", offer.OrderID).Scan(&orderState, &orderMode, &orderStoreID); errors.Is(err, sql.ErrNoRows) {
		return CaptainOfferResult{}, ErrOrderNotFound
	} else if err != nil {
		return CaptainOfferResult{}, err
	} else if orderState != "READY_FOR_DISPATCH" || (offer.SourceStoreID == "" && orderMode != FulfillmentModeBthwaniCaptain) || (offer.SourceStoreID != "" && (orderMode != FulfillmentModePartnerCaptain || orderStoreID != offer.SourceStoreID)) {
		return CaptainOfferResult{}, ErrCaptainAssignmentConflict
	}
	if offer.SourceStoreID != "" {
		var membershipID string
		if err := tx.QueryRowContext(ctx, `SELECT id FROM dsh.store_captain_memberships WHERE store_id=$1 AND captain_actor_id=$2 AND state='active' FOR SHARE`, offer.SourceStoreID, captainActorID).Scan(&membershipID); errors.Is(err, sql.ErrNoRows) {
			return CaptainOfferResult{}, ErrCaptainNotEligible
		} else if err != nil {
			return CaptainOfferResult{}, err
		}
	}
	if err := requireCaptainGoodsCustodyLimitTx(ctx, tx, offer.OrderID, captainActorID); err != nil {
		return CaptainOfferResult{}, err
	}
	assignmentID, err := newID("captain-assignment")
	if err != nil {
		return CaptainOfferResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='accepted',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2`, offer.ID, offer.Version); err != nil {
		return CaptainOfferResult{}, err
	}
	offer.State = "accepted"
	offer.Version++
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_assignments(id,order_id,captain_actor_id,accepted_offer_id,state,version) VALUES($1,$2,$3,$4,'assigned',1)`, assignmentID, offer.OrderID, captainActorID, offer.ID); err != nil {
		if isUniqueViolation(err) {
			return CaptainOfferResult{}, ErrCaptainAssignmentConflict
		}
		return CaptainOfferResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_handoffs(assignment_id,order_id,store_id,state,version) SELECT $1,id,store_id,'pending',1 FROM dsh.commerce_orders WHERE id=$2`, assignmentID, offer.OrderID); err != nil {
		return CaptainOfferResult{}, err
	}
	var assignment CaptainAssignment
	var orderVersion int
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.commerce_orders SET state='CAPTAIN_ASSIGNED',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='READY_FOR_DISPATCH' RETURNING version`, offer.OrderID).Scan(&orderVersion); err != nil {
		return CaptainOfferResult{}, err
	}
	if offer.SourceStoreID == "" && admissionAvailability == "available" {
		if err := reserveCaptainAvailabilityTx(ctx, tx, admissionID, captainActorID, idempotencyKey, requestHash, captainActorID, correlationID); err != nil {
			return CaptainOfferResult{}, err
		}
	}
	if offer.SourceStoreID == "" {
		// The winner is now assigned, so dispatch presence is no longer needed.
		// Losing captains retain only their time-bounded latest presence.
		if _, err := tx.ExecContext(ctx, `DELETE FROM dsh.captain_presence_latest WHERE captain_actor_id=$1`, captainActorID); err != nil {
			return CaptainOfferResult{}, err
		}
		if err := supersedePendingCaptainOffersTx(ctx, tx, offer.OrderID, offer.ID, captainActorID, correlationID); err != nil {
			return CaptainOfferResult{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,assignment_id,result_version) VALUES($1,$2,'respond_offer',$3,$4,$5,1)`, idempotencyKey, requestHash, offer.OrderID, offer.ID, assignmentID); err != nil {
		return CaptainOfferResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,assignment_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_accepted',$1,$2,$3,$4,$5,$6,$7,'offered','assigned',1,$8)`, idempotencyKey, correlationID, captainActorID, offer.OrderID, offer.ID, assignmentID, captainActorID, requestHash); err != nil {
		return CaptainOfferResult{}, err
	}
	assignment, err = readCaptainAssignmentTx(ctx, tx, "id=$1", assignmentID)
	if err != nil {
		return CaptainOfferResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainOfferResult{}, err
	}
	return CaptainOfferResult{Offer: offer, Assignment: &assignment}, nil
}
