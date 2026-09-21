package postgres

import (
	"context"
	"crypto/subtle"
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
	ErrCaptainDeliveryTaskNotFound = errors.New("captain delivery task was not found")
	ErrCaptainDeliveryTaskInvalid  = errors.New("captain delivery task is not currently available")
	ErrCaptainAssignmentConflict   = errors.New("captain assignment is in conflict")
	ErrCaptainCustodyConflict      = errors.New("captain custody transition is not allowed")
	ErrCaptainTerminalConflict     = errors.New("captain assignment is already terminal")
	ErrDeliveryProofInvalid        = errors.New("delivery proof is invalid")
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
	ID                  string
	OrderID             string
	CaptainActorID      string
	State               string
	ExpiresAt           time.Time
	Version             int
	CreatedAt           time.Time
	UpdatedAt           time.Time
	StoreName           string
	CustomerAddressText string
	AmountDueMinor      int64
	Currency            string
	PaymentMethod       string
	PaymentState        string
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

type CaptainDeliveryTask struct {
	AssignmentID         string
	OrderReference       string
	StoreID              string
	StoreName            string
	PickupLatitude       float64
	PickupLongitude      float64
	CustomerAddressText  string
	DestinationLatitude  float64
	DestinationLongitude float64
	OrderState           string
	HandoffState         string
	DeliveryState        string
	PaymentMethod        string
	PaymentState         string
	AmountDueMinor       int64
	Currency             string
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

func HashCaptainCompletionRequest(assignmentID, result string, collectedAmountMinor int64, deliveryProofCode string, expectedVersion int) string {
	return hashFacts("captain-complete", strings.TrimSpace(assignmentID), strings.TrimSpace(result), strconv.FormatInt(collectedAmountMinor, 10), strings.TrimSpace(deliveryProofCode), strconv.Itoa(expectedVersion))
}

func ValidateCaptainDeliveryProof(ctx context.Context, db *sql.DB, assignmentID, captainActorID, deliveryProofCode string) error {
	assignmentID = strings.TrimSpace(assignmentID)
	captainActorID = strings.TrimSpace(captainActorID)
	deliveryProofCode = strings.TrimSpace(deliveryProofCode)
	if db == nil || assignmentID == "" || captainActorID == "" || len(deliveryProofCode) != 6 {
		return ErrDeliveryProofInvalid
	}
	assignment, err := ReadCaptainAssignment(ctx, db, assignmentID)
	if err != nil {
		return err
	}
	if assignment.CaptainActorID != captainActorID {
		return ErrDeliveryProofInvalid
	}
	var proofHash, proofState string
	if err := db.QueryRowContext(ctx, `SELECT code_hash,state FROM dsh.commerce_order_delivery_proofs WHERE order_id=$1`, assignment.OrderID).Scan(&proofHash, &proofState); errors.Is(err, sql.ErrNoRows) {
		return ErrDeliveryProofInvalid
	} else if err != nil {
		return err
	}
	proofMatches := subtle.ConstantTimeCompare([]byte(proofHash), []byte(HashDeliveryProofCode(assignment.OrderID, deliveryProofCode))) == 1
	if assignment.State == "delivered" && proofState == "VERIFIED" && proofMatches {
		return nil
	}
	if assignment.State != "in_custody" || assignment.Handoff.State != "completed" || proofState != "PENDING" || !proofMatches {
		return ErrDeliveryProofInvalid
	}
	return nil
}

func HashCaptainRecoveryRequest(assignmentID string, expectedVersion int) string {
	return hashFacts("captain-recover", strings.TrimSpace(assignmentID), strconv.Itoa(expectedVersion))
}

func HashCaptainAccessRequest(actorID, role string, enabled bool, expectedVersion int) string {
	return hashFacts("captain-access", strings.TrimSpace(actorID), strings.TrimSpace(role), strconv.FormatBool(enabled), strconv.Itoa(expectedVersion))
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
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var actorID string
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(actor_id,'') FROM dsh.captain_admissions WHERE id=$1`, strings.TrimSpace(admissionID)).Scan(&actorID); errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	} else if err != nil {
		return CaptainAdmission{}, err
	}
	if actorID != "" {
		if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
			return CaptainAdmission{}, err
		}
	}
	admission, err := readCaptainAdmissionTx(ctx, tx, "id=$1", strings.TrimSpace(admissionID))
	if err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return admission, nil
}

func ReadCaptainAdmissionForActor(ctx context.Context, db *sql.DB, actorID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, strings.TrimSpace(actorID)); err != nil {
		return CaptainAdmission{}, err
	}
	admission, err := readCaptainAdmissionTx(ctx, tx, "actor_id=$1", strings.TrimSpace(actorID))
	if err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return admission, nil
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
	if err := canonicalizeCaptainOffersTx(ctx, tx, strings.TrimSpace(actorID)); err != nil {
		return CaptainAdmission{}, false, err
	}
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

// SuspendCaptainAdmission is the DSH half of a managed Captain role disable.
// It releases offers, reopens pre-custody assignments for dispatch, and leaves
// the admission unavailable before Identity security is changed.
func SuspendCaptainAdmission(ctx context.Context, db *sql.DB, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	actorID = strings.TrimSpace(actorID)
	if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
		return CaptainAdmission{}, err
	}
	replayed, err := captainAdmissionAccessReplayTx(ctx, tx, "captain_admission_suspended", idempotencyKey, requestHash)
	if err != nil {
		return CaptainAdmission{}, err
	}
	if replayed {
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "actor_id=$1", actorID)
		if readErr != nil {
			return CaptainAdmission{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return admission, nil
	}
	var offerID, offerOrderID string
	err = tx.QueryRowContext(ctx, `SELECT id,order_id FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered' FOR UPDATE`, actorID).Scan(&offerID, &offerOrderID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, err
	}

	var admission CaptainAdmission
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,state,availability_state,version,created_at,updated_at FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, actorID).Scan(&admission.ID, &admission.ActorID, &admission.State, &admission.AvailabilityState, &admission.Version, &admission.CreatedAt, &admission.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, err
	}
	if admission.State != "eligible" {
		if admission.State != "suspended" {
			return CaptainAdmission{}, ErrCaptainNotEligible
		}
	}

	var assignmentID, orderID, assignmentState string
	err = tx.QueryRowContext(ctx, `SELECT id,order_id,state FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody') FOR UPDATE`, actorID).Scan(&assignmentID, &orderID, &assignmentState)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, err
	}
	if assignmentState == "in_custody" {
		return CaptainAdmission{}, ErrCaptainCustodyConflict
	}
	if assignmentID != "" {
		var assignmentVersion int
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_assignments SET state='reassigned',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='assigned' RETURNING version`, assignmentID).Scan(&assignmentVersion); err != nil {
			return CaptainAdmission{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_handoffs SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE assignment_id=$1 AND state <> 'superseded'`, assignmentID); err != nil {
			return CaptainAdmission{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_orders SET state='READY_FOR_DISPATCH',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='CAPTAIN_ASSIGNED'`, orderID); err != nil {
			return CaptainAdmission{}, err
		}
		assignmentKey := idempotencyKey + ":assignment:" + assignmentID
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,assignment_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('captain_assignment_reassigned',$1,$2,$3,$4,$5,$6,'assigned','reassigned',$7,$8)`, assignmentKey, correlationID, actingActorID, orderID, assignmentID, actorID, assignmentVersion, requestHash); err != nil {
			return CaptainAdmission{}, err
		}
		var paymentIntentID sql.NullString
		var paymentState string
		if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, orderID).Scan(&paymentIntentID, &paymentState); err != nil {
			return CaptainAdmission{}, err
		}
		if paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: assignmentID, OrderID: orderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: actorID, IdempotencyKey: assignmentKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
				return CaptainAdmission{}, err
			}
		}
	}

	if offerID != "" {
		var supersededVersion int
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='offered' RETURNING version`, offerID).Scan(&supersededVersion); err != nil {
			return CaptainAdmission{}, err
		}
		offerKey := idempotencyKey + ":offer:" + offerID
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('captain_offer_superseded_by_access',$1,$2,$3,$4,$5,$6,'offered','superseded',$7,$8)`, offerKey, correlationID, actingActorID, offerOrderID, offerID, actorID, supersededVersion, requestHash); err != nil {
			return CaptainAdmission{}, err
		}
		var paymentIntentID sql.NullString
		var paymentState string
		if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, offerOrderID).Scan(&paymentIntentID, &paymentState); err != nil {
			return CaptainAdmission{}, err
		}
		if paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: offerID, OrderID: offerOrderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: actorID, IdempotencyKey: offerKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
				return CaptainAdmission{}, err
			}
		}
	}
	if admission.State == "suspended" {
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return admission, nil
	}

	var suspended CaptainAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET state='suspended',availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='eligible' RETURNING id,actor_id,state,availability_state,version,created_at,updated_at`, admission.ID).Scan(&suspended.ID, &suspended.ActorID, &suspended.State, &suspended.AvailabilityState, &suspended.Version, &suspended.CreatedAt, &suspended.UpdatedAt); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_admission_suspended',$1,$2,$3,$4,$5,'eligible','suspended',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, suspended.ID, actorID, admission.Version, suspended.Version, requestHash); err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return suspended, nil
}

// RestoreCaptainAdmission restores operational eligibility only. It always
// returns the Captain unavailable so an operator cannot silently grant work.
func RestoreCaptainAdmission(ctx context.Context, db *sql.DB, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	actorID = strings.TrimSpace(actorID)
	if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
		return CaptainAdmission{}, err
	}
	replayed, err := captainAdmissionAccessReplayTx(ctx, tx, "captain_admission_restored", idempotencyKey, requestHash)
	if err != nil {
		return CaptainAdmission{}, err
	}
	if replayed {
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "actor_id=$1", actorID)
		if readErr != nil {
			return CaptainAdmission{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return admission, nil
	}
	var admission CaptainAdmission
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,state,availability_state,version,created_at,updated_at FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, actorID).Scan(&admission.ID, &admission.ActorID, &admission.State, &admission.AvailabilityState, &admission.Version, &admission.CreatedAt, &admission.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, err
	}
	if admission.State == "pending_identity" {
		return CaptainAdmission{}, ErrCaptainNotEligible
	}
	if admission.State == "eligible" {
		if admission.AvailabilityState == "available" {
			var updated CaptainAdmission
			if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='eligible' AND availability_state='available' RETURNING id,actor_id,state,availability_state,version,created_at,updated_at`, admission.ID).Scan(&updated.ID, &updated.ActorID, &updated.State, &updated.AvailabilityState, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
				return CaptainAdmission{}, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,'available','unavailable',$6,$7,$8)`, idempotencyKey+":availability", correlationID, actingActorID, updated.ID, actorID, admission.Version, updated.Version, requestHash); err != nil {
				return CaptainAdmission{}, err
			}
			admission = updated
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return admission, nil
	}
	var hasActiveWork bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered') OR EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody'))`, actorID).Scan(&hasActiveWork); err != nil {
		return CaptainAdmission{}, err
	}
	if hasActiveWork {
		return CaptainAdmission{}, ErrCaptainCustodyConflict
	}
	var restored CaptainAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET state='eligible',availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='suspended' RETURNING id,actor_id,state,availability_state,version,created_at,updated_at`, admission.ID).Scan(&restored.ID, &restored.ActorID, &restored.State, &restored.AvailabilityState, &restored.Version, &restored.CreatedAt, &restored.UpdatedAt); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_admission_restored',$1,$2,$3,$4,$5,'suspended','eligible',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, restored.ID, actorID, admission.Version, restored.Version, requestHash); err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return restored, nil
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
	rows, err := tx.QueryContext(ctx, `SELECT offer.id,offer.order_id,offer.captain_actor_id,offer.state,offer.expires_at,offer.version,offer.created_at,offer.updated_at,s.name,o.address_text,o.total_amount_minor,o.currency,o.payment_method,o.payment_state
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
		if err := rows.Scan(&item.ID, &item.OrderID, &item.CaptainActorID, &item.State, &item.ExpiresAt, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.StoreName, &item.CustomerAddressText, &item.AmountDueMinor, &item.Currency, &item.PaymentMethod, &item.PaymentState); err != nil {
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
		offer, readErr := readCaptainOfferTx(ctx, tx, "offer.id=$1", offerID)
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
	err = tx.QueryRowContext(ctx, `SELECT offer.id,offer.order_id,offer.captain_actor_id,offer.state,offer.expires_at,offer.version,offer.created_at,offer.updated_at,s.name,o.address_text,o.total_amount_minor,o.currency,o.payment_method,o.payment_state
		FROM dsh.captain_dispatch_offers offer
		JOIN dsh.commerce_orders o ON o.id=offer.order_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE offer.id=$1 FOR UPDATE OF offer`, offerID).Scan(&offer.ID, &offer.OrderID, &offer.CaptainActorID, &offer.State, &offer.ExpiresAt, &offer.Version, &offer.CreatedAt, &offer.UpdatedAt, &offer.StoreName, &offer.CustomerAddressText, &offer.AmountDueMinor, &offer.Currency, &offer.PaymentMethod, &offer.PaymentState)
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
			if err := restoreCaptainAvailabilityTx(ctx, tx, offer.CaptainActorID, key, hash, "system:captain-timeout", key); err != nil {
				return CaptainOfferResult{}, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_expired',$1,$2,$3,$4,$5,$6,'offered','expired',$7,$8) ON CONFLICT (event_type,idempotency_key) DO NOTHING`, key, key, "system:captain-timeout", offer.OrderID, offer.ID, offer.CaptainActorID, expiredVersion, hash); err != nil {
				return CaptainOfferResult{}, err
			}
			var paymentIntentID sql.NullString
			var paymentState string
			if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, offer.OrderID).Scan(&paymentIntentID, &paymentState); err != nil {
				return CaptainOfferResult{}, err
			}
			if paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
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
		if err := restoreCaptainAvailabilityTx(ctx, tx, captainActorID, idempotencyKey, requestHash, captainActorID, correlationID); err != nil {
			return CaptainOfferResult{}, err
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
		if paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
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
	if err := canonicalizeCaptainOffersTx(ctx, tx, ""); err != nil {
		return CaptainOffer{}, false, err
	}
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "reassign")
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
	var state, paymentState string
	var paymentIntentID sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT state,payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&state, &paymentIntentID, &paymentState); errors.Is(err, sql.ErrNoRows) {
		return CaptainOffer{}, false, ErrOrderNotFound
	} else if err != nil {
		return CaptainOffer{}, false, err
	}
	if state != "READY_FOR_DISPATCH" && state != "CAPTAIN_ASSIGNED" {
		return CaptainOffer{}, false, ErrCaptainCustodyConflict
	}
	var currentAssignmentID, oldCaptain, assignmentState, oldOfferID string
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
		if err := tx.QueryRowContext(ctx, "SELECT id,captain_actor_id FROM dsh.captain_dispatch_offers WHERE order_id=$1 AND state='offered' FOR UPDATE", orderID).Scan(&oldOfferID, &oldCaptain); err != nil && !errors.Is(err, sql.ErrNoRows) {
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
	if oldOfferID != "" {
		if paymentState != "REQUIRES_COLLECTION" || !paymentIntentID.Valid {
			return CaptainOffer{}, false, ErrPaymentStateConflict
		}
		if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: oldOfferID, OrderID: orderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: oldCaptain, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
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
		if state == "CAPTAIN_ASSIGNED" {
			if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_orders SET state='READY_FOR_DISPATCH',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='CAPTAIN_ASSIGNED'", orderID); err != nil {
				return CaptainOffer{}, false, err
			}
		}
		if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: currentAssignmentID, OrderID: orderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: oldCaptain, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
			return CaptainOffer{}, false, err
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

func CompleteCaptainAssignment(ctx context.Context, db *sql.DB, assignmentID, captainActorID, result string, collectedAmountMinor int64, deliveryProofCode string, expectedVersion int, idempotencyKey, requestHash, correlationID string) (CaptainAssignment, bool, error) {
	result = strings.ToLower(strings.TrimSpace(result))
	deliveryProofCode = strings.TrimSpace(deliveryProofCode)
	if result != "delivered" && result != "delivery_failed" {
		return CaptainAssignment{}, false, ErrCaptainTerminalConflict
	}
	if collectedAmountMinor < 0 || (result != "delivered" && collectedAmountMinor != 0) {
		return CaptainAssignment{}, false, ErrPaymentStateConflict
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
	if result == "delivered" {
		var proofHash, proofState string
		if err := tx.QueryRowContext(ctx, `SELECT code_hash,state FROM dsh.commerce_order_delivery_proofs WHERE order_id=$1 FOR UPDATE`, orderID).Scan(&proofHash, &proofState); errors.Is(err, sql.ErrNoRows) {
			return CaptainAssignment{}, false, ErrDeliveryProofInvalid
		} else if err != nil {
			return CaptainAssignment{}, false, err
		}
		if proofState != "PENDING" || len(deliveryProofCode) != 6 || subtle.ConstantTimeCompare([]byte(proofHash), []byte(HashDeliveryProofCode(orderID, deliveryProofCode))) != 1 {
			return CaptainAssignment{}, false, ErrDeliveryProofInvalid
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_delivery_proofs SET state='VERIFIED',verified_by=$2,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE order_id=$1 AND state='PENDING'`, orderID, captainActorID); err != nil {
			return CaptainAssignment{}, false, err
		}
	}
	var paymentIntentID sql.NullString
	var paymentAmount int64
	var currentPaymentState, storeID, fulfillmentMode string
	if err := tx.QueryRowContext(ctx, "SELECT payment_intent_id,total_amount_minor,payment_state,store_id,fulfillment_mode FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&paymentIntentID, &paymentAmount, &currentPaymentState, &storeID, &fulfillmentMode); err != nil {
		return CaptainAssignment{}, false, err
	}
	orderState := "DELIVERED"
	if result == "delivery_failed" {
		orderState = "DELIVERY_FAILED"
	}
	if result == "delivered" {
		if fulfillmentMode != "BTHWANI_CAPTAIN" {
			return CaptainAssignment{}, false, ErrOrderStateConflict
		}
		switch currentPaymentState {
		case "REQUIRES_COLLECTION":
			if !paymentIntentID.Valid || collectedAmountMinor <= 0 || collectedAmountMinor != paymentAmount {
				return CaptainAssignment{}, false, ErrPaymentStateConflict
			}
			var partnerActorID string
			if err := tx.QueryRowContext(ctx, "SELECT partner_actor_id FROM dsh.stores WHERE id=$1", storeID).Scan(&partnerActorID); err != nil {
				return CaptainAssignment{}, false, err
			}
			if strings.TrimSpace(partnerActorID) == "" {
				return CaptainAssignment{}, false, ErrPaymentStateConflict
			}
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "DELIVERY_SETTLEMENT", SourceRef: assignmentID, OrderID: orderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: captainActorID, PartnerActorID: partnerActorID, AmountMinor: paymentAmount, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: captainActorID}); err != nil {
				return CaptainAssignment{}, false, err
			}
		case "COLLECTED":
			if collectedAmountMinor != 0 && collectedAmountMinor != paymentAmount {
				return CaptainAssignment{}, false, ErrPaymentStateConflict
			}
		default:
			return CaptainAssignment{}, false, ErrPaymentStateConflict
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
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.captain_admissions SET availability_state='available',version=version+1,updated_at=clock_timestamp() WHERE actor_id=$1 AND state='eligible' AND availability_state='unavailable'", captainActorID); err != nil {
			return CaptainAssignment{}, false, err
		}
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
	var orderID, captainActorID, assignmentState, handoffState string
	var version int
	err = tx.QueryRowContext(ctx, `SELECT a.order_id,a.captain_actor_id,a.state,a.version,h.state
		FROM dsh.captain_assignments a
		JOIN dsh.captain_handoffs h ON h.assignment_id=a.id
		WHERE a.id=$1
		FOR UPDATE OF a,h`, strings.TrimSpace(assignmentID)).Scan(&orderID, &captainActorID, &assignmentState, &version, &handoffState)
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
	err = tx.QueryRowContext(ctx, `SELECT a.id,a.order_id,s.id,s.name,s.delivery_origin_latitude,s.delivery_origin_longitude,o.address_text,o.address_latitude,o.address_longitude,o.state,h.state,a.state,o.payment_method,o.payment_state,o.total_amount_minor,o.currency
		FROM dsh.captain_assignments a
		JOIN dsh.captain_handoffs h ON h.assignment_id=a.id
		JOIN dsh.commerce_orders o ON o.id=a.order_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE a.id=$1 AND a.captain_actor_id=$2 AND a.state <> 'reassigned'`, strings.TrimSpace(assignmentID), strings.TrimSpace(captainActorID)).Scan(
		&task.AssignmentID, &task.OrderReference, &task.StoreID, &task.StoreName, &pickupLatitude, &pickupLongitude,
		&task.CustomerAddressText, &destinationLatitude, &destinationLongitude, &task.OrderState, &task.HandoffState, &task.DeliveryState,
		&task.PaymentMethod, &task.PaymentState, &task.AmountDueMinor, &task.Currency)
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
	rows, err := tx.QueryContext(ctx, `SELECT id FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state<>'reassigned' ORDER BY created_at DESC,id DESC LIMIT $2`, actorID, limit)
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

type captainOperation struct {
	AdmissionID   string
	OrderID       string
	OfferID       string
	AssignmentID  string
	ResultVersion int
}

func captainAdmissionAccessReplayTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, requestHash string) (bool, error) {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:captain-access:"+idempotencyKey); err != nil {
		return false, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT event_type,request_hash FROM dsh.captain_admission_audit WHERE idempotency_key=$1 ORDER BY id FOR UPDATE`, idempotencyKey)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	count := 0
	matching := false
	for rows.Next() {
		var storedEventType, storedHash string
		if err := rows.Scan(&storedEventType, &storedHash); err != nil {
			return false, err
		}
		count++
		matching = matching || (storedEventType == eventType && storedHash == requestHash)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil
	}
	if count != 1 || !matching {
		return false, ErrCaptainOperationConflict
	}
	return true, nil
}

// CanonicalizeCaptainOffers applies the DSH timeout state transition for
// expired offers. It is deliberately lazy: every relevant read/write boundary
// invokes the same transaction-local implementation, so no worker or timer is
// a second owner of operational state.
func CanonicalizeCaptainOffers(ctx context.Context, db *sql.DB, actorID string) error {
	if db == nil {
		return ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, strings.TrimSpace(actorID)); err != nil {
		return err
	}
	return tx.Commit()
}

func canonicalizeCaptainOffersTx(ctx context.Context, tx *sql.Tx, actorID string) error {
	query := `SELECT id,order_id,captain_actor_id,version FROM dsh.captain_dispatch_offers WHERE state='offered' AND expires_at <= clock_timestamp()`
	args := []any{}
	if strings.TrimSpace(actorID) != "" {
		query += " AND captain_actor_id=$1"
		args = append(args, strings.TrimSpace(actorID))
	}
	query += " ORDER BY id FOR UPDATE"
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	type expiredOffer struct {
		ID             string
		OrderID        string
		CaptainActorID string
		Version        int
	}
	offers := make([]expiredOffer, 0)
	for rows.Next() {
		var offer expiredOffer
		if err := rows.Scan(&offer.ID, &offer.OrderID, &offer.CaptainActorID, &offer.Version); err != nil {
			_ = rows.Close()
			return err
		}
		offers = append(offers, offer)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, offer := range offers {
		var resultVersion int
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='expired',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='offered' AND version=$2 RETURNING version`, offer.ID, offer.Version).Scan(&resultVersion); errors.Is(err, sql.ErrNoRows) {
			continue
		} else if err != nil {
			return err
		}
		key := "captain-timeout:" + offer.ID
		hash := hashFacts("captain-offer-expired", offer.ID)
		if err := restoreCaptainAvailabilityTx(ctx, tx, offer.CaptainActorID, key, hash, "system:captain-timeout", key); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('dispatch_offer_expired',$1,$2,$3,$4,$5,$6,'offered','expired',$7,$8) ON CONFLICT (event_type,idempotency_key) DO NOTHING`, key, key, "system:captain-timeout", offer.OrderID, offer.ID, offer.CaptainActorID, resultVersion, hash); err != nil {
			return err
		}
		var paymentIntentID sql.NullString
		var paymentState string
		if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, offer.OrderID).Scan(&paymentIntentID, &paymentState); err != nil {
			return err
		}
		if paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: offer.ID, OrderID: offer.OrderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: offer.CaptainActorID, IdempotencyKey: key, CorrelationID: key, ActingActorID: "system:captain-timeout"}); err != nil {
				return err
			}
		}
	}
	return nil
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
	err := source.QueryRowContext(ctx, `SELECT offer.id,offer.order_id,offer.captain_actor_id,offer.state,offer.expires_at,offer.version,offer.created_at,offer.updated_at,s.name,o.address_text,o.total_amount_minor,o.currency,o.payment_method,o.payment_state
		FROM dsh.captain_dispatch_offers offer
		JOIN dsh.commerce_orders o ON o.id=offer.order_id
		JOIN dsh.stores s ON s.id=o.store_id
		WHERE `+where, args...).Scan(&item.ID, &item.OrderID, &item.CaptainActorID, &item.State, &item.ExpiresAt, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.StoreName, &item.CustomerAddressText, &item.AmountDueMinor, &item.Currency, &item.PaymentMethod, &item.PaymentState)
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
