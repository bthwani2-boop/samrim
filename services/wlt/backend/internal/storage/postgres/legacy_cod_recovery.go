package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
	"github.com/lib/pq"
)

var (
	ErrLegacyCODRecoveryInput      = errors.New("legacy COD recovery facts are invalid")
	ErrLegacyCODRecoveryNotFound   = errors.New("legacy COD recovery review does not exist")
	ErrLegacyCODRecoveryState      = errors.New("legacy COD recovery cannot proceed with this financial state")
	ErrLegacyCODRecoverySeparation = errors.New("independent Finance reviewer is required")
	ErrLegacyCODRecoveryEvidence   = errors.New("legacy COD recovery requires original Finance evidence")
)

type LegacyCODRecoveryInput struct {
	OrderID            string
	PaymentIntentID    string
	CaptainActorID     string
	EvidenceDocumentID string
	ActorID            string
	IdempotencyKey     string
	CorrelationID      string
}

type LegacyCODRecoveryApprovalInput struct {
	ReviewID       string
	ActorID        string
	IdempotencyKey string
	CorrelationID  string
}

type LegacyCODRecoveryRecord struct {
	ID                 string     `json:"id"`
	OrderID            string     `json:"orderId"`
	PaymentIntentID    string     `json:"paymentIntentId"`
	CaptainActorID     string     `json:"captainActorId"`
	AmountMinor        int64      `json:"amountMinor"`
	EvidenceDocumentID string     `json:"evidenceDocumentId"`
	SubmittedBy        string     `json:"submittedBy"`
	Status             string     `json:"status"`
	ApprovedBy         string     `json:"approvedBy,omitempty"`
	ReservationID      string     `json:"reservationId,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	ApprovedAt         *time.Time `json:"approvedAt,omitempty"`
	approvalKey        string
	submissionKey      string
	submissionHash     string
}

func SubmitLegacyCODRecovery(ctx context.Context, db *sql.DB, input LegacyCODRecoveryInput) (LegacyCODRecoveryRecord, bool, error) {
	input.OrderID = strings.TrimSpace(input.OrderID)
	input.PaymentIntentID = strings.TrimSpace(input.PaymentIntentID)
	input.CaptainActorID = strings.TrimSpace(input.CaptainActorID)
	input.EvidenceDocumentID = strings.TrimSpace(input.EvidenceDocumentID)
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.PaymentIntentID, 1, 128) == "" ||
		(len(input.OrderID) > 0 && boundedText(input.OrderID, 1, 128) == "") ||
		(len(input.CaptainActorID) > 0 && boundedText(input.CaptainActorID, 1, 128) == "") ||
		boundedText(input.EvidenceDocumentID, 1, 128) == "" ||
		boundedText(input.ActorID, 1, 128) == "" ||
		!validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:captain-cod:"+input.PaymentIntentID); err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}

	// Resolve original order and collector inside the WLT payment lock;
	// browser-supplied facts cannot redirect a historical cash obligation.
	var canonicalOrder, canonicalCaptain string
	err = tx.QueryRowContext(ctx, `SELECT a.order_id,COALESCE(p.collected_by_actor_id,'')
		FROM wlt.payment_intents p JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=p.id
		WHERE p.id=$1 FOR UPDATE OF p,a`, input.PaymentIntentID).Scan(&canonicalOrder, &canonicalCaptain)
	if errors.Is(err, sql.ErrNoRows) {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryState
	}
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	if (input.OrderID != "" && input.OrderID != canonicalOrder) ||
		(input.CaptainActorID != "" && input.CaptainActorID != canonicalCaptain) {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryState
	}
	input.OrderID, input.CaptainActorID = canonicalOrder, canonicalCaptain
	if input.ActorID == input.CaptainActorID {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryInput
	}
	requestHash := hashFacts("legacy-cod-recovery-review", input.OrderID, input.PaymentIntentID, input.CaptainActorID, input.EvidenceDocumentID, input.ActorID)
	amount, err := requireUnsettledLegacyCOD(ctx, tx, input.OrderID, input.PaymentIntentID, input.CaptainActorID)
	if err != nil {
		// An exact replay still reads the existing accepted review below.
		var existing LegacyCODRecoveryRecord
		existing, readErr := readLegacyCODRecoveryByPayment(ctx, tx, input.PaymentIntentID)
		if readErr == nil && existing.submissionKey == input.IdempotencyKey && existing.submissionHash == requestHash {
			if commitErr := tx.Commit(); commitErr != nil {
				return LegacyCODRecoveryRecord{}, false, commitErr
			}
			return existing, true, nil
		}
		if readErr != nil && !errors.Is(readErr, ErrLegacyCODRecoveryNotFound) {
			return LegacyCODRecoveryRecord{}, false, readErr
		}
		return LegacyCODRecoveryRecord{}, false, err
	}
	existing, readErr := readLegacyCODRecoveryByPayment(ctx, tx, input.PaymentIntentID)
	if readErr == nil {
		if existing.submissionKey == input.IdempotencyKey && existing.submissionHash == requestHash {
			if err := tx.Commit(); err != nil {
				return LegacyCODRecoveryRecord{}, false, err
			}
			return existing, true, nil
		}
		return LegacyCODRecoveryRecord{}, false, ErrIdempotencyConflict
	}
	if !errors.Is(readErr, ErrLegacyCODRecoveryNotFound) {
		return LegacyCODRecoveryRecord{}, false, readErr
	}

	var purpose, uploadedBy string
	if err := tx.QueryRowContext(ctx, "SELECT purpose,uploaded_by FROM wlt.finance_evidence_documents WHERE id=$1 FOR SHARE", input.EvidenceDocumentID).Scan(&purpose, &uploadedBy); errors.Is(err, sql.ErrNoRows) {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryEvidence
	} else if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	if purpose != "CAPTAIN_COD_LEGACY_RECOVERY" || uploadedBy != input.ActorID {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryEvidence
	}
	id, err := newID("cod-recovery")
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.captain_cod_legacy_recovery_reviews
		(id,payment_intent_id,order_id,captain_actor_id,amount_minor,evidence_document_id,
		submitted_by,submitted_idempotency_key,submitted_request_hash,submitted_correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		id, input.PaymentIntentID, input.OrderID, input.CaptainActorID, amount, input.EvidenceDocumentID,
		input.ActorID, input.IdempotencyKey, requestHash, input.CorrelationID)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, mapLegacyCODRecoveryConstraintError(err)
	}
	if err := tx.Commit(); err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	item, err := ReadLegacyCODRecovery(ctx, db, id)
	return item, false, err
}

func ApproveLegacyCODRecovery(ctx context.Context, db *sql.DB, input LegacyCODRecoveryApprovalInput) (LegacyCODRecoveryRecord, bool, error) {
	input.ReviewID = strings.TrimSpace(input.ReviewID)
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.ReviewID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" ||
		!validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	// Lock the same payment key as submission before the review row, so
	// simultaneous submission retries and approvals have no lock inversion.
	preview, err := readLegacyCODRecovery(ctx, tx, input.ReviewID, false)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:captain-cod:"+preview.PaymentIntentID); err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	item, err := readLegacyCODRecovery(ctx, tx, input.ReviewID, true)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	if item.SubmittedBy == input.ActorID || item.CaptainActorID == input.ActorID {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoverySeparation
	}
	if item.Status == "APPROVED" {
		if item.ApprovedBy == input.ActorID && item.approvalKey == input.IdempotencyKey {
			if err := tx.Commit(); err != nil {
				return LegacyCODRecoveryRecord{}, false, err
			}
			return item, true, nil
		}
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryState
	}
	if item.Status != "PENDING" {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryState
	}

	// Positive cash exposure comes only from the canonical WLT payment.
	amount, err := requireUnsettledLegacyCOD(ctx, tx, item.OrderID, item.PaymentIntentID, item.CaptainActorID)
	if err != nil || amount != item.AmountMinor {
		if err != nil {
			return LegacyCODRecoveryRecord{}, false, err
		}
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryState
	}
	var purpose, uploader string
	err = tx.QueryRowContext(ctx, "SELECT purpose,uploaded_by FROM wlt.finance_evidence_documents WHERE id=$1 FOR SHARE", item.EvidenceDocumentID).Scan(&purpose, &uploader)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	if purpose != "CAPTAIN_COD_LEGACY_RECOVERY" || uploader != item.SubmittedBy {
		return LegacyCODRecoveryRecord{}, false, ErrLegacyCODRecoveryEvidence
	}
	if err := lockCaptainWalletBalance(ctx, tx, item.CaptainActorID); err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	wallet, err := readCaptainWalletStateTx(ctx, tx, item.CaptainActorID)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	if wallet.AvailableMinor < item.AmountMinor {
		return LegacyCODRecoveryRecord{}, false, ErrCaptainWalletInsufficientFunds
	}

	reservationID, err := newID("captain-cod")
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	reserveKey := "legacy-cod-recovery:" + hashFacts(item.ID)
	requestHash := HashCaptainCODReservation(CaptainCODReservationInput{
		OrderID: item.OrderID, PaymentIntentID: item.PaymentIntentID, CaptainActorID: item.CaptainActorID,
	}, "legacy-recover")
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.captain_cod_reservations
		(id,order_id,payment_intent_id,captain_actor_id,amount_minor,currency,state,reserve_idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,$5,'YER','ACTIVE',$6,$7,$8)`,
		reservationID, item.OrderID, item.PaymentIntentID, item.CaptainActorID, item.AmountMinor,
		reserveKey, requestHash, input.CorrelationID)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, mapLegacyCODRecoveryConstraintError(err)
	}
	if err := insertCaptainCODReservationEvent(ctx, tx, reservationID, "CAPTAIN_COD_LEGACY_RECOVERED", input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE wlt.captain_cod_legacy_recovery_reviews
		SET status='APPROVED',approved_by=$2,approved_at=clock_timestamp(),
		approval_idempotency_key=$3,approval_correlation_id=$4,reservation_id=$5
		WHERE id=$1 AND status='PENDING'`,
		item.ID, input.ActorID, input.IdempotencyKey, input.CorrelationID, reservationID)
	if err != nil {
		return LegacyCODRecoveryRecord{}, false, mapLegacyCODRecoveryConstraintError(err)
	}
	if err := tx.Commit(); err != nil {
		return LegacyCODRecoveryRecord{}, false, err
	}
	result, err := ReadLegacyCODRecovery(ctx, db, input.ReviewID)
	return result, false, err
}

// Translate only known uniqueness races into domain outcomes. All other SQL
// failures remain storage errors; a concurrent Finance action must not become
// a misleading 502 merely because its pre-check won a stale snapshot.
func mapLegacyCODRecoveryConstraintError(err error) error {
	var conflict *pq.Error
	if !errors.As(err, &conflict) || conflict.Code != "23505" {
		return err
	}
	// PostgreSQL truncates generated constraint names at 63 bytes, so the
	// two long idempotency constraints may have shortened table prefixes.
	if strings.HasPrefix(conflict.Constraint, "captain_cod_legacy_recovery_rev") &&
		(strings.Contains(conflict.Constraint, "submitted_idempotency") ||
			strings.Contains(conflict.Constraint, "approval_idempotency")) {
		return ErrIdempotencyConflict
	}
	switch conflict.Constraint {
	case "captain_cod_legacy_recovery_reviews_evidence_document_id_key":
		return ErrLegacyCODRecoveryEvidence
	case "captain_cod_legacy_recovery_reviews_payment_intent_id_key",
		"captain_cod_legacy_recovery_reviews_order_id_key",
		"captain_cod_legacy_recovery_reviews_reservation_id_key",
		"captain_cod_reservations_active_order_uq",
		"captain_cod_reservations_active_payment_intent_uq":
		return ErrLegacyCODRecoveryState
	default:
		return err
	}
}

func requireUnsettledLegacyCOD(ctx context.Context, tx *sql.Tx, orderID, paymentIntentID, captainID string) (int64, error) {
	var state, method, currency, collector, allocationOrder, allocationCurrency, fulfillment string
	var amount, collected, cash int64
	err := tx.QueryRowContext(ctx, `SELECT p.state,p.method,p.amount_minor,p.currency,
		COALESCE(p.collected_by_actor_id,''),COALESCE(p.collected_amount_minor,0),
		a.order_id,a.currency,a.cash_amount_minor,a.fulfillment_mode
		FROM wlt.payment_intents p JOIN wlt.customer_payment_allocations a ON a.payment_intent_id=p.id
		WHERE p.id=$1 FOR UPDATE OF p,a`, paymentIntentID).
		Scan(&state, &method, &amount, &currency, &collector, &collected,
			&allocationOrder, &allocationCurrency, &cash, &fulfillment)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrLegacyCODRecoveryState
	}
	if err != nil {
		return 0, err
	}
	if state != domain.StateCollected || method != domain.MethodCashOnDelivery || currency != "YER" ||
		allocationCurrency != "YER" || allocationOrder != orderID || fulfillment != "BTHWANI_CAPTAIN" ||
		collector != captainID || amount <= 0 || cash != amount || collected != amount {
		return 0, ErrLegacyCODRecoveryState
	}
	var hasSettlement bool
	err = tx.QueryRowContext(ctx, `SELECT
		EXISTS(SELECT 1 FROM wlt.cash_remittances WHERE payment_intent_id=$1)
		OR EXISTS(SELECT 1 FROM wlt.captain_cod_reservations WHERE (payment_intent_id=$1 OR order_id=$2) AND state <> 'RELEASED')
		OR EXISTS(SELECT 1 FROM wlt.partner_order_earnings WHERE payment_intent_id=$1 OR order_id=$2)`,
		paymentIntentID, orderID).Scan(&hasSettlement)
	if err != nil {
		return 0, err
	}
	if hasSettlement {
		return 0, ErrLegacyCODRecoveryState
	}
	return cash, nil
}

func ReadLegacyCODRecoveryByPayment(ctx context.Context, db *sql.DB, paymentIntentID string) (LegacyCODRecoveryRecord, error) {
	paymentIntentID = strings.TrimSpace(paymentIntentID)
	if db == nil || boundedText(paymentIntentID, 1, 128) == "" {
		return LegacyCODRecoveryRecord{}, ErrLegacyCODRecoveryInput
	}
	return readLegacyCODRecoveryByPayment(ctx, db, paymentIntentID)
}

func ReadLegacyCODRecovery(ctx context.Context, db *sql.DB, reviewID string) (LegacyCODRecoveryRecord, error) {
	if db == nil || boundedText(strings.TrimSpace(reviewID), 1, 128) == "" {
		return LegacyCODRecoveryRecord{}, ErrLegacyCODRecoveryInput
	}
	return readLegacyCODRecovery(ctx, db, strings.TrimSpace(reviewID), false)
}

type legacyCODRecoveryReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readLegacyCODRecovery(ctx context.Context, source legacyCODRecoveryReader, id string, lock bool) (LegacyCODRecoveryRecord, error) {
	query := `SELECT id,order_id,payment_intent_id,captain_actor_id,amount_minor,
		evidence_document_id,submitted_by,status,COALESCE(approved_by,''),
		COALESCE(reservation_id,''),created_at,approved_at,
		COALESCE(approval_idempotency_key,''),submitted_idempotency_key,submitted_request_hash
		FROM wlt.captain_cod_legacy_recovery_reviews WHERE id=$1`
	if lock {
		query += " FOR UPDATE"
	}
	return scanLegacyCODRecovery(source.QueryRowContext(ctx, query, id))
}

func readLegacyCODRecoveryByPayment(ctx context.Context, source legacyCODRecoveryReader, paymentID string) (LegacyCODRecoveryRecord, error) {
	return scanLegacyCODRecovery(source.QueryRowContext(ctx, `SELECT id,order_id,payment_intent_id,captain_actor_id,
		amount_minor,evidence_document_id,submitted_by,status,COALESCE(approved_by,''),
		COALESCE(reservation_id,''),created_at,approved_at,
		COALESCE(approval_idempotency_key,''),submitted_idempotency_key,submitted_request_hash
		FROM wlt.captain_cod_legacy_recovery_reviews WHERE payment_intent_id=$1 FOR UPDATE`, paymentID))
}

func scanLegacyCODRecovery(row *sql.Row) (LegacyCODRecoveryRecord, error) {
	var item LegacyCODRecoveryRecord
	var approvedAt sql.NullTime
	err := row.Scan(&item.ID, &item.OrderID, &item.PaymentIntentID, &item.CaptainActorID,
		&item.AmountMinor, &item.EvidenceDocumentID, &item.SubmittedBy, &item.Status,
		&item.ApprovedBy, &item.ReservationID, &item.CreatedAt, &approvedAt,
		&item.approvalKey, &item.submissionKey, &item.submissionHash)
	if errors.Is(err, sql.ErrNoRows) {
		return LegacyCODRecoveryRecord{}, ErrLegacyCODRecoveryNotFound
	}
	if approvedAt.Valid {
		item.ApprovedAt = &approvedAt.Time
	}
	return item, err
}
