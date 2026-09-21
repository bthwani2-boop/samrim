package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

var (
	ErrNotFound            = errors.New("payment intent was not found")
	ErrIdempotencyConflict = errors.New("payment idempotency key was already used with different facts")
	ErrIntentExists        = errors.New("payment intent already exists for this external reference")
	ErrVersionConflict     = domain.ErrVersionConflict
	ErrStateConflict       = domain.ErrStateConflict
	ErrInvalidInput        = domain.ErrInvalidInput
	ErrAmountMismatch      = domain.ErrAmountMismatch
)

type PaymentIntentRecord struct {
	ID                   string
	ExternalReference    string
	PayerActorID         string
	AmountMinor          int64
	Currency             string
	Method               string
	State                string
	Version              int
	CollectedAmountMinor *int64
	CollectedByActorID   *string
	CollectionReference  *string
	CollectedAt          *time.Time
	CancellationReason   *string
	CreatedAt            time.Time
	UpdatedAt            time.Time
	CustomerPaymentAllocation *CustomerPaymentAllocationRecord
}

type CreatePaymentIntentInput struct {
	ExternalReference string
	PayerActorID      string
	OrderID           string
	AmountMinor       int64
	Currency          string
	Method            string
	CustomerPaymentAllocation *CustomerPaymentAllocationInput
	IdempotencyKey    string
	CorrelationID     string
}

type CollectPaymentIntentInput struct {
	IntentID             string
	CollectedAmountMinor int64
	CollectedByActorID   string
	CollectionReference  string
	ExpectedVersion      int
	IdempotencyKey       string
	CorrelationID        string
}

type CancelPaymentIntentInput struct {
	IntentID        string
	Reason          string
	ExpectedVersion int
	IdempotencyKey  string
	CorrelationID   string
}

func HashCreateRequest(input CreatePaymentIntentInput) string {
	parts := []string{"create", input.ExternalReference, input.PayerActorID, input.OrderID, fmt.Sprintf("%d", input.AmountMinor), input.Currency, input.Method}
	if input.CustomerPaymentAllocation != nil {
		allocation := input.CustomerPaymentAllocation
		parts = append(parts, allocation.OrderID, allocation.Currency, fmt.Sprintf("%d", allocation.SubtotalMinor), fmt.Sprintf("%d", allocation.DeliveryFeeMinor), fmt.Sprintf("%d", allocation.DiscountMinor), fmt.Sprintf("%d", allocation.InternalBalanceAmountMinor), fmt.Sprintf("%d", allocation.CashAmountMinor), fmt.Sprintf("%d", allocation.CustomerPayableMinor), allocation.PolicyVersion)
	}
	return hashFacts(parts...)
}

func HashCollectRequest(input CollectPaymentIntentInput) string {
	return hashFacts("collect", input.IntentID, fmt.Sprintf("%d", input.CollectedAmountMinor), input.CollectedByActorID, input.CollectionReference, fmt.Sprintf("%d", input.ExpectedVersion))
}

func HashCancelRequest(input CancelPaymentIntentInput) string {
	return hashFacts("cancel", input.IntentID, input.Reason, fmt.Sprintf("%d", input.ExpectedVersion))
}

func CreatePaymentIntent(ctx context.Context, db *sql.DB, input CreatePaymentIntentInput) (PaymentIntentRecord, bool, error) {
	input.ExternalReference = strings.TrimSpace(input.ExternalReference)
	input.PayerActorID = strings.TrimSpace(input.PayerActorID)
	input.OrderID = strings.TrimSpace(input.OrderID)
	input.Currency = strings.TrimSpace(input.Currency)
	input.Method = strings.TrimSpace(input.Method)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if input.CustomerPaymentAllocation != nil {
		input.CustomerPaymentAllocation.OrderID = strings.TrimSpace(input.CustomerPaymentAllocation.OrderID)
		input.CustomerPaymentAllocation.Currency = strings.TrimSpace(input.CustomerPaymentAllocation.Currency)
		input.CustomerPaymentAllocation.PolicyVersion = strings.TrimSpace(input.CustomerPaymentAllocation.PolicyVersion)
	}
	if db == nil || domain.ValidateCreate(input.ExternalReference, input.PayerActorID, input.Currency, input.Method, input.AmountMinor) != nil || (input.OrderID != "" && (input.CustomerPaymentAllocation == nil || input.CustomerPaymentAllocation.OrderID != input.OrderID)) || (input.CustomerPaymentAllocation != nil && validateCustomerPaymentAllocation(*input.CustomerPaymentAllocation) != nil) || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PaymentIntentRecord{}, false, ErrInvalidInput
	}
	requestHash := HashCreateRequest(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PaymentIntentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:create:"+input.IdempotencyKey); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	var storedHash, existingID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,id FROM wlt.payment_intents WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &existingID)
	if err == nil {
		if storedHash != requestHash {
			return PaymentIntentRecord{}, false, ErrIdempotencyConflict
		}
		intent, readErr := readPaymentIntent(ctx, tx, existingID)
		if readErr != nil {
			return PaymentIntentRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PaymentIntentRecord{}, false, err
		}
		return intent, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PaymentIntentRecord{}, false, err
	}
	var duplicate string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.payment_intents WHERE external_reference=$1 AND method=$2", input.ExternalReference, input.Method).Scan(&duplicate); err == nil {
		return PaymentIntentRecord{}, false, ErrIntentExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return PaymentIntentRecord{}, false, err
	}
	intentID, err := newID("payment")
	if err != nil {
		return PaymentIntentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payment_intents(id,external_reference,payer_actor_id,amount_minor,currency,method,state,version,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9)`, intentID, input.ExternalReference, input.PayerActorID, input.AmountMinor, input.Currency, input.Method, domain.StateRequiresCollect, input.IdempotencyKey, requestHash); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	amount := input.AmountMinor
	if err := insertEvent(ctx, tx, intentID, "PAYMENT_INTENT_CREATED", input.IdempotencyKey, requestHash, nil, input.CorrelationID, "", domain.StateRequiresCollect, &amount, nil); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	if input.CustomerPaymentAllocation != nil {
		if err := validateCustomerPaymentAllocation(*input.CustomerPaymentAllocation); err != nil {
			return PaymentIntentRecord{}, false, err
		}
		if _, err := insertCustomerPaymentAllocationTx(ctx, tx, *input.CustomerPaymentAllocation, intentID, input.IdempotencyKey+"-allocation", requestHash, input.CorrelationID); err != nil {
			return PaymentIntentRecord{}, false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	intent, err := ReadPaymentIntent(ctx, db, intentID)
	return intent, false, err
}

func ReadPaymentIntent(ctx context.Context, db *sql.DB, intentID string) (PaymentIntentRecord, error) {
	if db == nil || strings.TrimSpace(intentID) == "" {
		return PaymentIntentRecord{}, ErrInvalidInput
	}
	return readPaymentIntent(ctx, db, strings.TrimSpace(intentID))
}

func CollectPaymentIntent(ctx context.Context, db *sql.DB, input CollectPaymentIntentInput) (PaymentIntentRecord, bool, error) {
	input.IntentID = strings.TrimSpace(input.IntentID)
	input.CollectedByActorID = strings.TrimSpace(input.CollectedByActorID)
	input.CollectionReference = strings.TrimSpace(input.CollectionReference)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.ExpectedVersion < 1 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return PaymentIntentRecord{}, false, ErrInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PaymentIntentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	requestHash := HashCollectRequest(input)
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:collect:"+input.IdempotencyKey); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	var storedHash, existingIntentID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,intent_id FROM wlt.payment_intent_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &existingIntentID)
	if err == nil {
		if storedHash != requestHash || existingIntentID != input.IntentID {
			return PaymentIntentRecord{}, false, ErrIdempotencyConflict
		}
		intent, readErr := readPaymentIntent(ctx, tx, input.IntentID)
		if readErr != nil {
			return PaymentIntentRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PaymentIntentRecord{}, false, err
		}
		return intent, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PaymentIntentRecord{}, false, err
	}
	var current PaymentIntentRecord
	if err := scanPaymentIntent(tx.QueryRowContext(ctx, `SELECT id,external_reference,payer_actor_id,amount_minor,currency,method,state,version,collected_amount_minor,collected_by_actor_id,collection_reference,collected_at,cancellation_reason,created_at,updated_at FROM wlt.payment_intents WHERE id=$1 FOR UPDATE`, input.IntentID), &current); errors.Is(err, sql.ErrNoRows) {
		return PaymentIntentRecord{}, false, ErrNotFound
	} else if err != nil {
		return PaymentIntentRecord{}, false, err
	}
	if current.Version != input.ExpectedVersion {
		return PaymentIntentRecord{}, false, ErrVersionConflict
	}
	if !domain.CanCollect(current.State) {
		return PaymentIntentRecord{}, false, ErrStateConflict
	}
	if err := domain.ValidateCollect(input.CollectedByActorID, input.CollectionReference, input.CollectedAmountMinor, current.AmountMinor); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.payment_intents SET state=$2,version=version+1,collected_amount_minor=$3,collected_by_actor_id=$4,collection_reference=NULLIF($5,''),collected_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND version=$6`, input.IntentID, domain.StateCollected, input.CollectedAmountMinor, input.CollectedByActorID, input.CollectionReference, input.ExpectedVersion); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	amount := input.CollectedAmountMinor
	if err := insertEvent(ctx, tx, input.IntentID, "PAYMENT_INTENT_COLLECTED", input.IdempotencyKey, requestHash, &input.CollectedByActorID, input.CorrelationID, current.State, domain.StateCollected, &amount, nil); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	intent, err := ReadPaymentIntent(ctx, db, input.IntentID)
	return intent, false, err
}

func CancelPaymentIntent(ctx context.Context, db *sql.DB, input CancelPaymentIntentInput) (PaymentIntentRecord, bool, error) {
	input.IntentID = strings.TrimSpace(input.IntentID)
	input.Reason = strings.TrimSpace(input.Reason)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.ExpectedVersion < 1 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 || domain.ValidateCancel(input.Reason) != nil {
		return PaymentIntentRecord{}, false, ErrInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PaymentIntentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	requestHash := HashCancelRequest(input)
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:cancel:"+input.IdempotencyKey); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	var storedHash, existingIntentID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,intent_id FROM wlt.payment_intent_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &existingIntentID)
	if err == nil {
		if storedHash != requestHash || existingIntentID != input.IntentID {
			return PaymentIntentRecord{}, false, ErrIdempotencyConflict
		}
		intent, readErr := readPaymentIntent(ctx, tx, input.IntentID)
		if readErr != nil {
			return PaymentIntentRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return PaymentIntentRecord{}, false, err
		}
		return intent, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PaymentIntentRecord{}, false, err
	}
	var current PaymentIntentRecord
	if err := scanPaymentIntent(tx.QueryRowContext(ctx, `SELECT id,external_reference,payer_actor_id,amount_minor,currency,method,state,version,collected_amount_minor,collected_by_actor_id,collection_reference,collected_at,cancellation_reason,created_at,updated_at FROM wlt.payment_intents WHERE id=$1 FOR UPDATE`, input.IntentID), &current); errors.Is(err, sql.ErrNoRows) {
		return PaymentIntentRecord{}, false, ErrNotFound
	} else if err != nil {
		return PaymentIntentRecord{}, false, err
	}
	if current.Version != input.ExpectedVersion {
		return PaymentIntentRecord{}, false, ErrVersionConflict
	}
	if !domain.CanCancel(current.State) {
		return PaymentIntentRecord{}, false, ErrStateConflict
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.payment_intents SET state=$2,version=version+1,cancellation_reason=$3,updated_at=clock_timestamp() WHERE id=$1 AND version=$4`, input.IntentID, domain.StateCancelled, input.Reason, input.ExpectedVersion); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	if err := insertEvent(ctx, tx, input.IntentID, "PAYMENT_INTENT_CANCELLED", input.IdempotencyKey, requestHash, nil, input.CorrelationID, current.State, domain.StateCancelled, nil, &input.Reason); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PaymentIntentRecord{}, false, err
	}
	intent, err := ReadPaymentIntent(ctx, db, input.IntentID)
	return intent, false, err
}

type rowScanner interface{ Scan(dest ...any) error }

func readPaymentIntent(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, intentID string) (PaymentIntentRecord, error) {
	var result PaymentIntentRecord
	err := scanPaymentIntent(source.QueryRowContext(ctx, `SELECT id,external_reference,payer_actor_id,amount_minor,currency,method,state,version,collected_amount_minor,collected_by_actor_id,collection_reference,collected_at,cancellation_reason,created_at,updated_at FROM wlt.payment_intents WHERE id=$1`, intentID), &result)
	if errors.Is(err, sql.ErrNoRows) {
		return PaymentIntentRecord{}, ErrNotFound
	}
	if err == nil {
		allocation, allocationErr := readCustomerPaymentAllocation(ctx, source, result.ID)
		if allocationErr == nil {
			result.CustomerPaymentAllocation = &allocation
		} else if !errors.Is(allocationErr, ErrCustomerPaymentAllocationNotFound) {
			return PaymentIntentRecord{}, allocationErr
		}
	}
	return result, err
}

func scanPaymentIntent(row rowScanner, result *PaymentIntentRecord) error {
	var collectedAmount sql.NullInt64
	var collectedBy, collectionReference, cancellationReason sql.NullString
	var collectedAt sql.NullTime
	err := row.Scan(&result.ID, &result.ExternalReference, &result.PayerActorID, &result.AmountMinor, &result.Currency, &result.Method, &result.State, &result.Version, &collectedAmount, &collectedBy, &collectionReference, &collectedAt, &cancellationReason, &result.CreatedAt, &result.UpdatedAt)
	if err != nil {
		return err
	}
	if collectedAmount.Valid {
		value := collectedAmount.Int64
		result.CollectedAmountMinor = &value
	}
	if collectedBy.Valid {
		value := collectedBy.String
		result.CollectedByActorID = &value
	}
	if collectionReference.Valid {
		value := collectionReference.String
		result.CollectionReference = &value
	}
	if collectedAt.Valid {
		value := collectedAt.Time
		result.CollectedAt = &value
	}
	if cancellationReason.Valid {
		value := cancellationReason.String
		result.CancellationReason = &value
	}
	return nil
}

func insertEvent(ctx context.Context, tx *sql.Tx, intentID, eventType, idempotencyKey, requestHash string, actorID *string, correlationID, fromState, toState string, amountMinor *int64, reason *string) error {
	eventID, err := newID("payment_event")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.payment_intent_events(id,intent_id,event_type,idempotency_key,request_hash,actor_id,correlation_id,from_state,to_state,amount_minor,reason) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9,$10,$11)`, eventID, intentID, eventType, idempotencyKey, requestHash, actorID, correlationID, fromState, toState, amountMinor, reason)
	return err
}

func newID(prefix string) (string, error) {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return prefix + "_" + hex.EncodeToString(value), nil
}

func hashFacts(values ...string) string {
	digest := sha256.New()
	for _, value := range values {
		_, _ = digest.Write([]byte{0})
		_, _ = digest.Write([]byte(value))
	}
	return hex.EncodeToString(digest.Sum(nil))
}
