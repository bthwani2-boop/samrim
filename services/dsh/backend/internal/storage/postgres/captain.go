package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
	"time"
)

const captainOfferTimeout = 10 * time.Minute

var (
	ErrCaptainAdmissionNotFound    = errors.New("captain admission was not found")
	ErrCaptainAdmissionExists      = errors.New("captain admission already exists")
	ErrCaptainAdmissionConflict    = errors.New("captain admission is in conflict")
	ErrCaptainAdmissionNotEligible = errors.New("captain admission is not eligible")
	ErrCaptainOperationConflict    = errors.New("captain operation idempotency key was already used with different facts")
	ErrCaptainVersionConflict      = errors.New("captain state is stale")
	ErrCaptainNotEligible          = errors.New("captain is not eligible for this operation")
	ErrCaptainNoAvailable          = errors.New("no eligible available captain is available")
	ErrCaptainDispatchConflict     = errors.New("order already has an active dispatch decision")
	ErrCaptainOfferNotFound        = errors.New("captain dispatch offer was not found")
	ErrCaptainOfferExpired         = errors.New("captain dispatch offer has expired")
	ErrCaptainOfferConflict        = errors.New("captain dispatch offer is not actionable")
	ErrCaptainOfferForbidden       = errors.New("captain dispatch offer belongs to another captain")
	ErrCaptainAssignmentNotFound   = errors.New("captain assignment was not found")
	ErrCaptainAssignmentConflict   = errors.New("captain assignment is in conflict")
	ErrCaptainCustodyConflict      = errors.New("captain custody transition is not allowed")
	ErrCaptainTerminalConflict     = errors.New("captain assignment is already terminal")
)

type CaptainAdmission struct {
	ID                string
	ActorID           string
	State             string
	AvailabilityState string
	Version           int
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type CaptainOffer struct {
	ID             string
	OrderID        string
	CaptainActorID string
	State          string
	ExpiresAt      time.Time
	Version        int
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type CaptainHandoff struct {
	AssignmentID      string
	OrderID           string
	StoreID           string
	State             string
	Version           int
	StoreConfirmedAt  *time.Time
	CaptainPickedUpAt *time.Time
}

type CaptainAssignment struct {
	ID               string
	OrderID          string
	CaptainActorID   string
	AcceptedOfferID  string
	State            string
	Version          int
	CustodyStartedAt *time.Time
	TerminalResult   string
	TerminalAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
	Handoff          CaptainHandoff
}

type CaptainOfferResult struct {
	Offer      CaptainOffer
	Assignment *CaptainAssignment
	Replayed   bool
}

type CaptainOperationResult struct {
	Assignment CaptainAssignment
	Replayed   bool
}

func HashCaptainAdmissionRequest(phone string) string {
	return hashFacts("captain-admission", strings.TrimSpace(phone))
}

func HashCaptainAvailabilityRequest(actorID string, available bool, expectedVersion int) string {
	return hashFacts("captain-availability", strings.TrimSpace(actorID), strconv.FormatBool(available), strconv.Itoa(expectedVersion))
}

func HashCaptainDispatchRequest(orderID string) string {
	return hashFacts("captain-dispatch", strings.TrimSpace(orderID))
}

func HashCaptainOfferResponse(offerID, decision string, expectedVersion int) string {
	return hashFacts("captain-offer-response", strings.TrimSpace(offerID), strings.TrimSpace(decision), strconv.Itoa(expectedVersion))
}

func HashCaptainReassignmentRequest(orderID string) string {
	return hashFacts("captain-reassign", strings.TrimSpace(orderID))
}

func HashCaptainHandoffRequest(assignmentID, storeID string, expectedVersion int) string {
	return hashFacts("captain-store-handoff", strings.TrimSpace(assignmentID), strings.TrimSpace(storeID), strconv.Itoa(expectedVersion))
}

func HashCaptainPickupRequest(assignmentID string, expectedVersion int) string {
	return hashFacts("captain-pickup", strings.TrimSpace(assignmentID), strconv.Itoa(expectedVersion))
}

func HashCaptainCompletionRequest(assignmentID, result string, expectedVersion int) string {
	return hashFacts("captain-complete", strings.TrimSpace(assignmentID), strings.TrimSpace(result), strconv.Itoa(expectedVersion))
}

func CreateCaptainAdmissionCandidate(ctx context.Context, db *sql.DB, phone, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, bool, error) {
	if db == nil || strings.TrimSpace(phone) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, false, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:captain-admission:"+idempotencyKey); err != nil {
		return CaptainAdmission{}, false, err
	}
	var storedHash, admissionID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,admission_id FROM dsh.captain_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &admissionID)
	if err == nil {
		if storedHash != requestHash {
			return CaptainAdmission{}, false, ErrCaptainOperationConflict
		}
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return CaptainAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, false, err
		}
		return admission, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, err
	}
	var existing string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.captain_admissions WHERE contact_phone_e164=$1 AND state='pending_identity' FOR UPDATE", strings.TrimSpace(phone)).Scan(&existing); err == nil {
		return CaptainAdmission{}, false, ErrCaptainAdmissionExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, err
	}
	admissionID, err = newID("captain-admission")
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admissions(id,contact_phone_e164,state,availability_state,version) VALUES($1,$2,'pending_identity','unavailable',1)`, admissionID, strings.TrimSpace(phone)); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'create',1,'pending_identity')`, idempotencyKey, requestHash, admissionID); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,to_state,result_version,request_hash) VALUES('captain_admission_created',$1,$2,$3,$4,'pending_identity',1,$5)`, idempotencyKey, correlationID, actingActorID, admissionID, requestHash); err != nil {
		return CaptainAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, false, err
	}
	admission, err := ReadCaptainAdmission(ctx, db, admissionID)
	return admission, true, err
}

func ReadCaptainAdmission(ctx context.Context, db *sql.DB, admissionID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	return readCaptainAdmissionTx(ctx, db, "id=$1", strings.TrimSpace(admissionID))
}

func ReadCaptainAdmissionForActor(ctx context.Context, db *sql.DB, actorID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	return readCaptainAdmissionTx(ctx, db, "actor_id=$1", strings.TrimSpace(actorID))
}

func BindCaptainAdmission(ctx context.Context, db *sql.DB, admissionID, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var current CaptainAdmission
	var actorStateID, phone sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,contact_phone_e164,state,availability_state,version,created_at,updated_at FROM dsh.captain_admissions WHERE id=$1 FOR UPDATE`, admissionID).Scan(&current.ID, &actorStateID, &phone, &current.State, &current.AvailabilityState, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, err
	}
	if actorStateID.Valid {
		current.ActorID = actorStateID.String
	}
	if current.State == "eligible" && current.ActorID == actorID {
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return current, nil
	}
	if current.State != "pending_identity" || current.ActorID != "" || !phone.Valid {
		return CaptainAdmission{}, ErrCaptainAdmissionConflict
	}
	var updated CaptainAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET actor_id=$2,contact_phone_e164=NULL,state='eligible',availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_identity' AND version=$3 RETURNING id,actor_id,state,availability_state,version,created_at,updated_at`, admissionID, actorID, current.Version).Scan(&updated.ID, &updated.ActorID, &updated.State, &updated.AvailabilityState, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_admission_idempotency SET result_version=$2,result_state='eligible',result_actor_id=$3 WHERE idempotency_key=$1 AND request_hash=$4`, idempotencyKey, updated.Version, actorID, requestHash); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_admission_bound',$1,$2,$3,$4,$5,'pending_identity','eligible',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, actorID, current.Version, updated.Version, requestHash); err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return updated, nil
}

func SetCaptainAvailability(ctx context.Context, db *sql.DB, actorID string, available bool, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, bool, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, false, ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "availability")
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if replay != nil {
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "id=$1", replay.AdmissionID)
		if readErr != nil {
			return CaptainAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, false, err
		}
		return admission, true, nil
	}
	var admission CaptainAdmission
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,state,availability_state,version,created_at,updated_at FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, actorID).Scan(&admission.ID, &admission.ActorID, &admission.State, &admission.AvailabilityState, &admission.Version, &admission.CreatedAt, &admission.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if admission.State != "eligible" {
		return CaptainAdmission{}, false, ErrCaptainNotEligible
	}
	if admission.Version != expectedVersion {
		return CaptainAdmission{}, false, ErrCaptainVersionConflict
	}
	if available {
		var hasActiveWork bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered') OR EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody'))`, actorID).Scan(&hasActiveWork); err != nil {
			return CaptainAdmission{}, false, err
		}
		if hasActiveWork {
			return CaptainAdmission{}, false, ErrCaptainOperationConflict
		}
	}
	wanted := "unavailable"
	if available {
		wanted = "available"
	}
	previousAvailability := admission.AvailabilityState
	if admission.AvailabilityState != wanted {
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3 RETURNING actor_id,state,availability_state,version,created_at,updated_at`, admission.ID, wanted, expectedVersion).Scan(&admission.ActorID, &admission.State, &admission.AvailabilityState, &admission.Version, &admission.CreatedAt, &admission.UpdatedAt); err != nil {
			return CaptainAdmission{}, false, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,admission_id,result_version) VALUES($1,$2,'availability',$3,$4)`, idempotencyKey, requestHash, admission.ID, admission.Version); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, idempotencyKey, correlationID, actingActorID, admission.ID, actorID, previousAvailability, wanted, expectedVersion, admission.Version, requestHash); err != nil {
		return CaptainAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, false, err
	}
	return admission, false, nil
}

func CreateCaptainDispatchOffer(ctx context.Context, db *sql.DB, orderID, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainOffer, bool, error) {
	return createCaptainDispatchOffer(ctx, db, orderID, "", idempotencyKey, requestHash, actingActorID, correlationID, "dispatch")
}

func createCaptainDispatchOffer(ctx context.Context, db *sql.DB, orderID, excludeCaptainID, idempotencyKey, requestHash, actingActorID, correlationID, operation string) (CaptainOffer, bool, error) {
	if db == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainOffer{}, false, ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainOffer{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, operation)
	if err != nil {
		return CaptainOffer{}, false, err
	}
	if replay != nil {
		offer, readErr := readCaptainOfferTx(ctx, tx, "id=$1", replay.OfferID)
		if readErr != nil {
			return CaptainOffer{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainOffer{}, false, err
		}
		return offer, true, nil
	}
	var state string
	var orderVersion int
	if err := tx.QueryRowContext(ctx, "SELECT state,version FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&state, &orderVersion); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrOrderNotFound
	} else if err != nil {
		return CaptainOffer{}, false, err
	}
	if state != "READY_FOR_DISPATCH" {
		return CaptainOffer{}, false, ErrCaptainDispatchConflict
	}
	var active string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.captain_dispatch_offers WHERE order_id=$1 AND state='offered' FOR UPDATE", orderID).Scan(&active); err == nil {
		return CaptainOffer{}, false, ErrCaptainDispatchConflict
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, err
	}
	var admissionID, captainID string
	query := "SELECT id,actor_id FROM dsh.captain_admissions WHERE state='eligible' AND availability_state='available' AND NOT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=dsh.captain_admissions.actor_id AND state='offered') AND NOT EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=dsh.captain_admissions.actor_id AND state IN ('assigned','in_custody'))"
	args := []any{}
	if strings.TrimSpace(excludeCaptainID) != "" {
		args = append(args, strings.TrimSpace(excludeCaptainID))
		query += " AND actor_id<>$1"
	}
	query += " ORDER BY updated_at,actor_id LIMIT 1 FOR UPDATE SKIP LOCKED"
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&admissionID, &captainID); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrCaptainNoAvailable
	} else if err != nil {
		return CaptainOffer{}, false, err
	}
	offerID, err := newID("captain-offer")
	if err != nil {
		return CaptainOffer{}, false, err
	}
	expiresAt := time.Now().UTC().Add(captainOfferTimeout)
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,version,idempotency_key,request_hash) VALUES($1,$2,$3,'offered',$4,1,$5,$6)`, offerID, orderID, captainID, expiresAt, idempotencyKey, requestHash); err != nil {
		if isUniqueViolation(err) {
			return CaptainOffer{}, false, ErrCaptainDispatchConflict
		}
		return CaptainOffer{}, false, err
	}
	if err := reserveCaptainAvailabilityTx(ctx, tx, admissionID, captainID, idempotencyKey, requestHash, actingActorID, correlationID); err != nil {
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,$3,$4,$5,1)`, idempotencyKey, requestHash, operation, orderID, offerID); err != nil {
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,to_state,result_version,request_hash) VALUES('dispatch_offer_created',$1,$2,$3,$4,$5,$6,'offered',1,$7)`, idempotencyKey, correlationID, actingActorID, orderID, offerID, captainID, requestHash); err != nil {
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
	return readCaptainOfferTx(ctx, db, "id=$1", strings.TrimSpace(offerID))
}

func ListCaptainOffers(ctx context.Context, db *sql.DB, actorID string, limit int) ([]CaptainOffer, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || limit < 1 || limit > 100 {
		return nil, ErrCaptainOperationConflict
	}
	rows, err := db.QueryContext(ctx, `SELECT id,order_id,captain_actor_id,state,expires_at,version,created_at,updated_at FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state<>'superseded' ORDER BY created_at DESC,id DESC LIMIT $2`, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CaptainOffer, 0)
	for rows.Next() {
		var item CaptainOffer
		if err := rows.Scan(&item.ID, &item.OrderID, &item.CaptainActorID, &item.State, &item.ExpiresAt, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
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
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "respond_offer")
	if err != nil {
		return CaptainOfferResult{}, err
	}
	if replay != nil {
		offer, readErr := readCaptainOfferTx(ctx, tx, "id=$1", offerID)
		if readErr != nil {
			return CaptainOfferResult{}, readErr
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
	var offer CaptainOffer
	err = tx.QueryRowContext(ctx, `SELECT id,order_id,captain_actor_id,state,expires_at,version,created_at,updated_at FROM dsh.captain_dispatch_offers WHERE id=$1 FOR UPDATE`, offerID).Scan(&offer.ID, &offer.OrderID, &offer.CaptainActorID, &offer.State, &offer.ExpiresAt, &offer.Version, &offer.CreatedAt, &offer.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainOfferResult{}, ErrCaptainOfferNotFound
	}
	if err != nil {
		return CaptainOfferResult{}, err
	}
	if offer.CaptainActorID != captainActorID {
		return CaptainOfferResult{}, ErrCaptainOfferForbidden
	}
	if offer.Version != expectedVersion {
		return CaptainOfferResult{}, ErrCaptainVersionConflict
	}
	if offer.State != "offered" {
		return CaptainOfferResult{}, ErrCaptainOfferConflict
	}
	if !time.Now().UTC().Before(offer.ExpiresAt) {
		newVersion := offer.Version + 1
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='expired',version=$2,updated_at=clock_timestamp() WHERE id=$1 AND version=$3`, offer.ID, newVersion, offer.Version); err != nil {
			return CaptainOfferResult{}, err
		}
		if err := restoreCaptainAvailabilityTx(ctx, tx, captainActorID, idempotencyKey, requestHash, captainActorID, correlationID); err != nil {
			return CaptainOfferResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,'respond_offer',$3,$4,$5)`, idempotencyKey, requestHash, offer.OrderID, offer.ID, newVersion); err != nil {
			return CaptainOfferResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_expired',$1,$2,$3,$4,$5,$6,'offered','expired',$7,$8)`, idempotencyKey, correlationID, captainActorID, offer.OrderID, offer.ID, captainActorID, newVersion, requestHash); err != nil {
			return CaptainOfferResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return CaptainOfferResult{}, err
		}
		return CaptainOfferResult{}, ErrCaptainOfferExpired
	}
	if decision == "reject" {
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='rejected',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2`, offer.ID, offer.Version); err != nil {
			return CaptainOfferResult{}, err
		}
		offer.State = "rejected"
		offer.Version++
		if err := restoreCaptainAvailabilityTx(ctx, tx, captainActorID, idempotencyKey, requestHash, captainActorID, correlationID); err != nil {
			return CaptainOfferResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,'respond_offer',$3,$4,$5)`, idempotencyKey, requestHash, offer.OrderID, offer.ID, offer.Version); err != nil {
			return CaptainOfferResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_rejected',$1,$2,$3,$4,$5,$6,'offered','rejected',$7,$8)`, idempotencyKey, correlationID, captainActorID, offer.OrderID, offer.ID, captainActorID, offer.Version, requestHash); err != nil {
			return CaptainOfferResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return CaptainOfferResult{}, err
		}
		return CaptainOfferResult{Offer: offer}, nil
	}
	var admissionID, admissionState, admissionAvailability string
	if err := tx.QueryRowContext(ctx, "SELECT id,state,availability_state FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE", captainActorID).Scan(&admissionID, &admissionState, &admissionAvailability); errors.Is(err, sql.ErrNoRows) {
		return CaptainOfferResult{}, ErrCaptainNotEligible
	} else if err != nil {
		return CaptainOfferResult{}, err
	} else if admissionState != "eligible" {
		return CaptainOfferResult{}, ErrCaptainNotEligible
	}
	var orderState string
	if err := tx.QueryRowContext(ctx, "SELECT state FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", offer.OrderID).Scan(&orderState); errors.Is(err, sql.ErrNoRows) {
		return CaptainOfferResult{}, ErrOrderNotFound
	} else if err != nil {
		return CaptainOfferResult{}, err
	} else if orderState != "READY_FOR_DISPATCH" {
		return CaptainOfferResult{}, ErrCaptainAssignmentConflict
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
	if admissionAvailability == "available" {
		if err := reserveCaptainAvailabilityTx(ctx, tx, admissionID, captainActorID, idempotencyKey, requestHash, captainActorID, correlationID); err != nil {
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

func ReassignCaptain(ctx context.Context, db *sql.DB, orderID, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainOffer, bool, error) {
	if db == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainOffer{}, false, ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainOffer{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "reassign")
	if err != nil {
		return CaptainOffer{}, false, err
	}
	if replay != nil {
		offer, readErr := readCaptainOfferTx(ctx, tx, "id=$1", replay.OfferID)
		if readErr != nil {
			return CaptainOffer{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainOffer{}, false, err
		}
		return offer, true, nil
	}
	var state string
	if err := tx.QueryRowContext(ctx, "SELECT state FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&state); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrOrderNotFound
	} else if err != nil {
		return CaptainOffer{}, false, err
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
	if oldCaptain == "" {
		if err := tx.QueryRowContext(ctx, "SELECT captain_actor_id FROM dsh.captain_dispatch_offers WHERE order_id=$1 AND state='offered' FOR UPDATE", orderID).Scan(&oldCaptain); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return CaptainOffer{}, false, err
		}
	}
	var candidateAdmissionID, captainID string
	if err := tx.QueryRowContext(ctx, "SELECT id,actor_id FROM dsh.captain_admissions WHERE state='eligible' AND availability_state='available' AND actor_id<>$1 AND NOT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=dsh.captain_admissions.actor_id AND state='offered') AND NOT EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=dsh.captain_admissions.actor_id AND state IN ('assigned','in_custody')) ORDER BY updated_at,actor_id LIMIT 1 FOR UPDATE SKIP LOCKED", oldCaptain).Scan(&candidateAdmissionID, &captainID); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrCaptainNoAvailable
	} else if err != nil {
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE dsh.captain_dispatch_offers SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE order_id=$1 AND state='offered'", orderID); err != nil {
		return CaptainOffer{}, false, err
	}
	if currentAssignmentID != "" {
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.captain_assignments SET state='reassigned',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='assigned'", currentAssignmentID); err != nil {
			return CaptainOffer{}, false, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.captain_handoffs SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE assignment_id=$1", currentAssignmentID); err != nil {
			return CaptainOffer{}, false, err
		}
		if state == "CAPTAIN_ASSIGNED" {
			if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state='READY_FOR_DISPATCH',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='CAPTAIN_ASSIGNED'", orderID); err != nil {
				return CaptainOffer{}, false, err
			}
		}
	}
	if oldCaptain != "" {
		if err := restoreCaptainAvailabilityTx(ctx, tx, oldCaptain, idempotencyKey, requestHash, actingActorID, correlationID); err != nil {
			return CaptainOffer{}, false, err
		}
	}
	offerID, err := newID("captain-offer")
	if err != nil {
		return CaptainOffer{}, false, err
	}
	expiresAt := time.Now().UTC().Add(captainOfferTimeout)
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_dispatch_offers(id,order_id,captain_actor_id,state,expires_at,version,idempotency_key,request_hash) VALUES($1,$2,$3,'offered',$4,1,$5,$6)`, offerID, orderID, captainID, expiresAt, idempotencyKey, requestHash); err != nil {
		return CaptainOffer{}, false, err
	}
	if err := reserveCaptainAvailabilityTx(ctx, tx, candidateAdmissionID, captainID, idempotencyKey, requestHash, actingActorID, correlationID); err != nil {
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,offer_id,result_version) VALUES($1,$2,'reassign',$3,$4,1)`, idempotencyKey, requestHash, orderID, offerID); err != nil {
		return CaptainOffer{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('captain_assignment_reassigned',$1,$2,$3,$4,$5,$6,$7,'offered',1,$8)`, idempotencyKey, correlationID, actingActorID, orderID, offerID, captainID, state, requestHash); err != nil {
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
		assignment, readErr := readCaptainAssignmentTx(ctx, tx, "id=$1", replay.AssignmentID)
		if readErr != nil {
			return CaptainAssignment{}, false, readErr
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
		assignment, readErr := readCaptainAssignmentTx(ctx, tx, "id=$1", replay.AssignmentID)
		if readErr != nil {
			return CaptainAssignment{}, false, readErr
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

func CompleteCaptainAssignment(ctx context.Context, db *sql.DB, assignmentID, captainActorID, result string, expectedVersion int, idempotencyKey, requestHash, correlationID string) (CaptainAssignment, bool, error) {
	result = strings.ToLower(strings.TrimSpace(result))
	if result != "delivered" && result != "delivery_failed" {
		return CaptainAssignment{}, false, ErrCaptainTerminalConflict
	}
	if db == nil || strings.TrimSpace(assignmentID) == "" || strings.TrimSpace(captainActorID) == "" || expectedVersion < 1 {
		return CaptainAssignment{}, false, ErrCaptainTerminalConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAssignment{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "complete")
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
	var orderID string
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_assignments SET state=$2,terminal_result=$3,terminal_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='in_custody' AND version=$4 RETURNING order_id`, assignmentID, result, result, expectedVersion).Scan(&orderID); err != nil {
		return CaptainAssignment{}, false, err
	}
	orderState := "DELIVERED"
	if result == "delivery_failed" {
		orderState = "DELIVERY_FAILED"
	}
	if result, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='IN_CUSTODY'", orderID, orderState); err != nil {
		return CaptainAssignment{}, false, err
	} else if rows, err := result.RowsAffected(); err != nil {
		return CaptainAssignment{}, false, err
	} else if rows != 1 {
		return CaptainAssignment{}, false, ErrCaptainTerminalConflict
	}
	if _, err := tx.ExecContext(ctx, "UPDATE dsh.captain_admissions SET availability_state='available',version=version+1,updated_at=clock_timestamp() WHERE actor_id=$1 AND state='eligible' AND availability_state='unavailable'", captainActorID); err != nil {
		return CaptainAssignment{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,order_id,assignment_id,result_version) VALUES($1,$2,'complete',$3,$4,$5)`, idempotencyKey, requestHash, orderID, assignmentID, assignment.Version+1); err != nil {
		return CaptainAssignment{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,assignment_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('delivery_completed',$1,$2,$3,$4,$5,$6,'in_custody',$7,$8,$9)`, idempotencyKey, correlationID, captainActorID, orderID, assignmentID, captainActorID, orderState, assignment.Version+1, requestHash); err != nil {
		return CaptainAssignment{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAssignment{}, false, err
	}
	assignment, err = ReadCaptainAssignment(ctx, db, assignmentID)
	return assignment, false, err
}

func ReadCaptainAssignment(ctx context.Context, db *sql.DB, assignmentID string) (CaptainAssignment, error) {
	if db == nil || strings.TrimSpace(assignmentID) == "" {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	return readCaptainAssignmentTx(ctx, db, "id=$1", strings.TrimSpace(assignmentID))
}

func ReadCaptainAssignmentForOrder(ctx context.Context, db *sql.DB, orderID string) (CaptainAssignment, error) {
	if db == nil || strings.TrimSpace(orderID) == "" {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	return readCaptainAssignmentTx(ctx, db, "order_id=$1 AND state IN ('assigned','in_custody','delivered','delivery_failed')", strings.TrimSpace(orderID))
}

func ListCaptainAssignments(ctx context.Context, db *sql.DB, actorID string, limit int) ([]CaptainAssignment, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || limit < 1 || limit > 100 {
		return nil, ErrCaptainOperationConflict
	}
	rows, err := db.QueryContext(ctx, `SELECT id FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state<>'reassigned' ORDER BY created_at DESC,id DESC LIMIT $2`, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CaptainAssignment, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		item, err := ReadCaptainAssignment(ctx, db, id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type captainOperation struct {
	AdmissionID   string
	OrderID       string
	OfferID       string
	AssignmentID  string
	ResultVersion int
}

func captainOperationReplayTx(ctx context.Context, tx *sql.Tx, idempotencyKey, requestHash, operation string) (*captainOperation, error) {
	var storedHash, storedOperation string
	var value captainOperation
	err := tx.QueryRowContext(ctx, `SELECT request_hash,operation,COALESCE(admission_id,''),COALESCE(order_id,''),COALESCE(offer_id,''),COALESCE(assignment_id,''),result_version FROM dsh.captain_operation_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedOperation, &value.AdmissionID, &value.OrderID, &value.OfferID, &value.AssignmentID, &value.ResultVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storedHash != requestHash || storedOperation != operation {
		return nil, ErrCaptainOperationConflict
	}
	return &value, nil
}

func reserveCaptainAvailabilityTx(ctx context.Context, tx *sql.Tx, admissionID, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) error {
	var version int
	err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND actor_id=$2 AND state='eligible' AND availability_state='available' RETURNING version`, admissionID, actorID).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCaptainNoAvailable
	}
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,'available','unavailable',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, actorID, version-1, version, requestHash)
	return err
}

func restoreCaptainAvailabilityTx(ctx context.Context, tx *sql.Tx, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) error {
	var admissionID, state, availability string
	if err := tx.QueryRowContext(ctx, `SELECT id,state,availability_state FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, actorID).Scan(&admissionID, &state, &availability); errors.Is(err, sql.ErrNoRows) {
		return ErrCaptainNotEligible
	} else if err != nil {
		return err
	}
	if state != "eligible" || availability != "unavailable" {
		return nil
	}
	var hasActiveWork bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered') OR EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody'))`, actorID).Scan(&hasActiveWork); err != nil {
		return err
	}
	if hasActiveWork {
		return nil
	}
	var version int
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state='available',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='eligible' AND availability_state='unavailable' RETURNING version`, admissionID).Scan(&version); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,'unavailable','available',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, actorID, version-1, version, requestHash)
	return err
}

func readCaptainAdmissionTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, where string, args ...any) (CaptainAdmission, error) {
	var item CaptainAdmission
	var actorID, phone string
	err := source.QueryRowContext(ctx, `SELECT id,COALESCE(actor_id,''),COALESCE(contact_phone_e164,''),state,availability_state,version,created_at,updated_at FROM dsh.captain_admissions WHERE `+where, args...).Scan(&item.ID, &actorID, &phone, &item.State, &item.AvailabilityState, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	item.ActorID = actorID
	return item, err
}

func readCaptainOfferTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, where string, args ...any) (CaptainOffer, error) {
	var item CaptainOffer
	err := source.QueryRowContext(ctx, `SELECT id,order_id,captain_actor_id,state,expires_at,version,created_at,updated_at FROM dsh.captain_dispatch_offers WHERE `+where, args...).Scan(&item.ID, &item.OrderID, &item.CaptainActorID, &item.State, &item.ExpiresAt, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, ErrCaptainOfferNotFound
	}
	return item, err
}

func readCaptainAssignmentTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, where string, args ...any) (CaptainAssignment, error) {
	var item CaptainAssignment
	var custodyStartedAt, terminalAt sql.NullTime
	var terminalResult sql.NullString
	err := source.QueryRowContext(ctx, `SELECT id,order_id,captain_actor_id,accepted_offer_id,state,version,custody_started_at,terminal_result,terminal_at,created_at,updated_at FROM dsh.captain_assignments WHERE `+where, args...).Scan(&item.ID, &item.OrderID, &item.CaptainActorID, &item.AcceptedOfferID, &item.State, &item.Version, &custodyStartedAt, &terminalResult, &terminalAt, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	if err != nil {
		return CaptainAssignment{}, err
	}
	if custodyStartedAt.Valid {
		value := custodyStartedAt.Time
		item.CustodyStartedAt = &value
	}
	if terminalResult.Valid {
		item.TerminalResult = terminalResult.String
	}
	if terminalAt.Valid {
		value := terminalAt.Time
		item.TerminalAt = &value
	}
	err = source.QueryRowContext(ctx, `SELECT assignment_id,order_id,store_id,state,version,store_confirmed_at,captain_picked_up_at FROM dsh.captain_handoffs WHERE assignment_id=$1`, item.ID).Scan(&item.Handoff.AssignmentID, &item.Handoff.OrderID, &item.Handoff.StoreID, &item.Handoff.State, &item.Handoff.Version, &custodyStartedAt, &terminalAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAssignment{}, ErrCaptainAssignmentNotFound
	}
	if err != nil {
		return CaptainAssignment{}, err
	}
	if custodyStartedAt.Valid {
		value := custodyStartedAt.Time
		item.Handoff.StoreConfirmedAt = &value
	}
	if terminalAt.Valid {
		value := terminalAt.Time
		item.Handoff.CaptainPickedUpAt = &value
	}
	return item, nil
}
