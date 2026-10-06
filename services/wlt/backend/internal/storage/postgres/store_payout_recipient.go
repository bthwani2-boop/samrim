package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrStorePayoutRecipientInvalidInput = errors.New("store payout recipient input is invalid")
	ErrStorePayoutRecipientNotFound     = errors.New("store payout recipient assignment was not found")
	ErrStorePayoutRecipientConflict     = errors.New("store payout recipient assignment conflict")
	ErrRecipientDestinationNotReady     = errors.New("payout recipient has no verified active official wallet destination")
	ErrPayoutRecipientReviewRequired    = errors.New("payout recipient review required for partner stores")
	ErrPayoutRecipientRoutingPending    = errors.New("partner store payout routing selected; partitioned settlement required")
	ErrStorePayoutRecipientOwnership    = errors.New("only the Store owner may change the payout recipient")
)

const (
	StorePayoutRecipientStateDefaultOwner     = "DEFAULT_OWNER"
	StorePayoutRecipientStateSelectedStaff    = "SELECTED_VERIFIED_STAFF"
	StorePayoutRecipientStateReviewRequired   = "RECIPIENT_REVIEW_REQUIRED"
	storePayoutRecipientFailClosedIdemKey     = "WLT_SYSTEM_FAIL_CLOSED"
	storePayoutRecipientFailClosedRequestHash = "0000000000000000000000000000000000000000000000000000000000000000"
)

type StorePayoutRecipientAssignmentRecord struct {
	ID                 string
	StoreID            string
	PartnerActorID     string
	BeneficiaryActorID string
	State              string
	Version            int
	EffectiveAt        time.Time
	AssignedByActorID  string
	Reason             string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type StorePayoutRecipientRecord struct {
	StoreID            string
	State              string
	BeneficiaryActorID string
	Version            int
	EffectiveAt        *time.Time
	OrderCount         int64
	PartnerNetMinor    int64
	LastEarningAt      *time.Time
}

type StorePayoutRecipientReadback struct {
	PartnerActorID string
	Currency       string
	Recipients     []StorePayoutRecipientRecord
	ReviewStores   []string
}

type SelectStorePayoutRecipientInput struct {
	StoreID            string
	PartnerActorID     string
	BeneficiaryActorID string
	BeneficiaryFacts   IdentityFacts
	Reason             string
	IdempotencyKey     string
	CorrelationID      string
}

type RevertStorePayoutRecipientInput struct {
	StoreID        string
	PartnerActorID string
	Reason         string
	IdempotencyKey string
	CorrelationID  string
}

func HashSelectStorePayoutRecipient(input SelectStorePayoutRecipientInput) string {
	return hashFacts("store-payout-recipient-select", strings.TrimSpace(input.StoreID), strings.TrimSpace(input.PartnerActorID), strings.TrimSpace(input.BeneficiaryActorID), strings.TrimSpace(input.Reason), input.BeneficiaryFacts.fingerprint())
}

func HashRevertStorePayoutRecipient(input RevertStorePayoutRecipientInput) string {
	return hashFacts("store-payout-recipient-revert", strings.TrimSpace(input.StoreID), strings.TrimSpace(input.PartnerActorID), strings.TrimSpace(input.Reason))
}

func normalizeStorePayoutRecipientKeys(input *SelectStorePayoutRecipientInput) {
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	input.BeneficiaryActorID = strings.TrimSpace(input.BeneficiaryActorID)
	input.BeneficiaryFacts = input.BeneficiaryFacts.normalized()
	input.Reason = strings.TrimSpace(input.Reason)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
}

// SelectStorePayoutRecipient records an owner-initiated verified-staff beneficiary for
// one Store. Recipient eligibility requires current verified Identity facts for the
// staff actor plus a current Finance-approved VERIFIED + ACTIVE_FOR_PAYOUT official
// destination; WLT independently re-checks both inside the transaction.
func SelectStorePayoutRecipient(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input SelectStorePayoutRecipientInput) (StorePayoutRecipientAssignmentRecord, bool, error) {
	normalizeStorePayoutRecipientKeys(&input)
	if db == nil || cipher == nil || boundedText(input.StoreID, 1, 128) == "" || boundedText(input.PartnerActorID, 1, 128) == "" ||
		boundedText(input.BeneficiaryActorID, 1, 128) == "" || input.BeneficiaryActorID == input.PartnerActorID ||
		boundedText(input.Reason, 1, 500) == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 ||
		len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 || !input.BeneficiaryFacts.validFor("partner", input.BeneficiaryActorID) {
		return StorePayoutRecipientAssignmentRecord{}, false, ErrStorePayoutRecipientInvalidInput
	}
	requestHash := HashSelectStorePayoutRecipient(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-payout:"+input.PartnerActorID); err != nil {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	var eventState string
	var eventVersion int
	err = tx.QueryRowContext(ctx, "SELECT to_state,result_version FROM wlt.store_payout_recipient_events WHERE idempotency_key=$1", input.IdempotencyKey).Scan(&eventState, &eventVersion)
	if err == nil {
		assignment, readErr := readStorePayoutRecipientAssignment(ctx, tx, input.StoreID)
		if readErr != nil && !errors.Is(readErr, ErrStorePayoutRecipientNotFound) {
			return StorePayoutRecipientAssignmentRecord{}, false, readErr
		}
		if readErr == nil && assignment.Version != eventVersion {
			return StorePayoutRecipientAssignmentRecord{}, false, ErrIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
			return StorePayoutRecipientAssignmentRecord{}, false, err
		}
		return assignment, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	var destinationID string
	var destinationVersion int
	if err := tx.QueryRowContext(ctx, "SELECT id,version FROM wlt.official_wallet_destinations WHERE actor_type='partner' AND actor_id=$1 AND verification_status='VERIFIED' AND status='ACTIVE_FOR_PAYOUT' FOR UPDATE", input.BeneficiaryActorID).Scan(&destinationID, &destinationVersion); errors.Is(err, sql.ErrNoRows) {
		return StorePayoutRecipientAssignmentRecord{}, false, ErrRecipientDestinationNotReady
	} else if err != nil {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	if err := input.BeneficiaryFacts.matchesStoredDestination(ctx, tx, cipher, destinationID, "partner", input.BeneficiaryActorID, true); err != nil {
		return StorePayoutRecipientAssignmentRecord{}, false, commitIdentityStaleness(tx, err)
	}
	var ownerCheck string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.store_payout_recipient_assignments WHERE store_id=$1 AND partner_actor_id=$2 FOR UPDATE", input.StoreID, input.PartnerActorID).Scan(&ownerCheck); err == nil {
		// ownership confirmed against the stored row below via read
	} else if errors.Is(err, sql.ErrNoRows) {
		var existingStore string
		if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.store_payout_recipient_assignments WHERE store_id=$1", input.StoreID).Scan(&existingStore); err == nil {
			return StorePayoutRecipientAssignmentRecord{}, false, ErrStorePayoutRecipientOwnership
		} else if !errors.Is(err, sql.ErrNoRows) {
			return StorePayoutRecipientAssignmentRecord{}, false, err
		}
	} else {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	var previous *StorePayoutRecipientAssignmentRecord
	existing, err := readStorePayoutRecipientAssignment(ctx, tx, input.StoreID)
	if err == nil {
		if existing.PartnerActorID != input.PartnerActorID {
			return StorePayoutRecipientAssignmentRecord{}, false, ErrStorePayoutRecipientOwnership
		}
		previous = &existing
	} else if !errors.Is(err, ErrStorePayoutRecipientNotFound) {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	assignmentID, err := newID("store-recipient")
	if err != nil {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	var result StorePayoutRecipientAssignmentRecord
	if previous == nil {
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.store_payout_recipient_assignments(id,store_id,partner_actor_id,beneficiary_actor_type,beneficiary_actor_id,state,version,effective_at,assigned_by_actor_id,reason,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,'partner',$4,'SELECTED_VERIFIED_STAFF',1,clock_timestamp(),$5,$6,$7,$8,$9)`, assignmentID, input.StoreID, input.PartnerActorID, input.BeneficiaryActorID, input.PartnerActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
			return StorePayoutRecipientAssignmentRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.store_payout_recipient_events(store_id,assignment_id,event_type,from_state,to_state,from_version,result_version,acting_actor_id,beneficiary_actor_id,reason,idempotency_key,request_hash,correlation_id) VALUES($1,$2,'STAFF_SELECTED','DEFAULT_OWNER','SELECTED_VERIFIED_STAFF',NULL,1,$3,$4,$5,$6,$7,$8)`, input.StoreID, assignmentID, input.PartnerActorID, input.BeneficiaryActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
			return StorePayoutRecipientAssignmentRecord{}, false, err
		}
	} else {
		eventType := "REASSIGNED_STAFF"
		if _, err := tx.ExecContext(ctx, `UPDATE wlt.store_payout_recipient_assignments SET beneficiary_actor_id=$2,state='SELECTED_VERIFIED_STAFF',version=version+1,effective_at=clock_timestamp(),assigned_by_actor_id=$3,reason=$4,idempotency_key=$5,request_hash=$6,correlation_id=$7,updated_at=clock_timestamp() WHERE store_id=$1 AND version=$8`, input.StoreID, input.BeneficiaryActorID, input.PartnerActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID, previous.Version); err != nil {
			return StorePayoutRecipientAssignmentRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.store_payout_recipient_events(store_id,assignment_id,event_type,from_state,to_state,from_version,result_version,acting_actor_id,beneficiary_actor_id,reason,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,'SELECTED_VERIFIED_STAFF',$5,$6,$7,$8,$9,$10,$11,$12)`, input.StoreID, assignmentID, eventType, previous.State, previous.Version, previous.Version+1, input.PartnerActorID, input.BeneficiaryActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
			return StorePayoutRecipientAssignmentRecord{}, false, err
		}
	}
	result, err = readStorePayoutRecipientAssignment(ctx, tx, input.StoreID)
	if err != nil {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StorePayoutRecipientAssignmentRecord{}, false, err
	}
	return result, false, nil
}

// RevertStorePayoutRecipientToOwner deletes the Store's explicit assignment so future
// unpinned payout intents route to the Partner owner (DEFAULT_OWNER needs no record).
// The immutable event ledger keeps the full history.
func RevertStorePayoutRecipientToOwner(ctx context.Context, db *sql.DB, input RevertStorePayoutRecipientInput) (bool, error) {
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.PartnerActorID = strings.TrimSpace(input.PartnerActorID)
	input.Reason = strings.TrimSpace(input.Reason)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.StoreID, 1, 128) == "" || boundedText(input.PartnerActorID, 1, 128) == "" ||
		boundedText(input.Reason, 1, 500) == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 ||
		len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return false, ErrStorePayoutRecipientInvalidInput
	}
	requestHash := HashRevertStorePayoutRecipient(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-payout:"+input.PartnerActorID); err != nil {
		return false, err
	}
	var eventState string
	err = tx.QueryRowContext(ctx, "SELECT to_state FROM wlt.store_payout_recipient_events WHERE idempotency_key=$1", input.IdempotencyKey).Scan(&eventState)
	if err == nil {
		if eventState != "DEFAULT_OWNER" {
			return false, ErrIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	existing, err := readStorePayoutRecipientAssignment(ctx, tx, input.StoreID)
	if errors.Is(err, ErrStorePayoutRecipientNotFound) {
		return false, ErrStorePayoutRecipientNotFound
	}
	if err != nil {
		return false, err
	}
	if existing.PartnerActorID != input.PartnerActorID {
		return false, ErrStorePayoutRecipientOwnership
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM wlt.store_payout_recipient_assignments WHERE store_id=$1 AND version=$2", input.StoreID, existing.Version); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.store_payout_recipient_events(store_id,assignment_id,event_type,from_state,to_state,from_version,result_version,acting_actor_id,beneficiary_actor_id,reason,idempotency_key,request_hash,correlation_id) VALUES($1,$2,'REVERTED_TO_OWNER',$3,'DEFAULT_OWNER',$4,$5,$6,$7,$8,$9,$10,$11)`, input.StoreID, existing.ID, existing.State, existing.Version, existing.Version, input.PartnerActorID, existing.BeneficiaryActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return false, nil
}

// MarkStorePayoutRecipientReviewRequired is the fail-closed entry used when canonical
// eligibility facts break (for example a suspended or revoked staff relationship).
// It never rewrites a committed payout snapshot; it blocks only future payout
// readiness for that Store until the owner selects or explicitly reconfirms a legal
// recipient. Absence of an assignment row is a no-op: default owner routing is
// unaffected by the eligibility break.
func MarkStorePayoutRecipientReviewRequired(ctx context.Context, db *sql.DB, storeID, partnerActorID, reason, correlationID string) (bool, error) {
	storeID, partnerActorID, reason, correlationID = strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID), strings.TrimSpace(reason), strings.TrimSpace(correlationID)
	if db == nil || boundedText(storeID, 1, 128) == "" || boundedText(partnerActorID, 1, 128) == "" || boundedText(reason, 1, 500) == "" || len(correlationID) < 8 || len(correlationID) > 128 {
		return false, ErrStorePayoutRecipientInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:partner-payout:"+partnerActorID); err != nil {
		return false, err
	}
	existing, err := readStorePayoutRecipientAssignment(ctx, tx, storeID)
	if errors.Is(err, ErrStorePayoutRecipientNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if existing.PartnerActorID != partnerActorID {
		return false, ErrStorePayoutRecipientOwnership
	}
	if existing.State == StorePayoutRecipientStateReviewRequired {
		return true, nil
	}
	eventID, err := newID("store-recipient-event")
	if err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.store_payout_recipient_assignments SET state='RECIPIENT_REVIEW_REQUIRED',version=version+1,effective_at=clock_timestamp(),reason=$2,idempotency_key=$3,request_hash=$4,correlation_id=$5,updated_at=clock_timestamp() WHERE store_id=$1 AND version=$6`, storeID, reason, storePayoutRecipientFailClosedIdemKey, storePayoutRecipientFailClosedRequestHash, correlationID, existing.Version); err != nil {
		return false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.store_payout_recipient_events(store_id,assignment_id,event_type,from_state,to_state,from_version,result_version,acting_actor_id,beneficiary_actor_id,reason,idempotency_key,request_hash,correlation_id) VALUES($1,$2,'MARKED_REVIEW_REQUIRED',$3,'RECIPIENT_REVIEW_REQUIRED',$4,$5,'WLT_SYSTEM',$6,$7,$8,$9,$10)`, storeID, existing.ID, existing.State, existing.Version, existing.Version+1, existing.BeneficiaryActorID, reason, eventID, storePayoutRecipientFailClosedRequestHash, correlationID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return false, nil
}

func readStorePayoutRecipientAssignment(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, storeID string) (StorePayoutRecipientAssignmentRecord, error) {
	var item StorePayoutRecipientAssignmentRecord
	err := source.QueryRowContext(ctx, `SELECT id,store_id,partner_actor_id,beneficiary_actor_id,state,version,effective_at,assigned_by_actor_id,reason,created_at,updated_at FROM wlt.store_payout_recipient_assignments WHERE store_id=$1`, storeID).Scan(&item.ID, &item.StoreID, &item.PartnerActorID, &item.BeneficiaryActorID, &item.State, &item.Version, &item.EffectiveAt, &item.AssignedByActorID, &item.Reason, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return StorePayoutRecipientAssignmentRecord{}, ErrStorePayoutRecipientNotFound
	}
	return item, err
}

// ListPartnerStorePayoutRecipients returns the effective payout recipient per Store
// for a Partner owner: explicit assignment rows where they exist, DEFAULT_OWNER
// otherwise, merged with per-Store earning attribution for the wallet readback.
func ListPartnerStorePayoutRecipients(ctx context.Context, db *sql.DB, partnerActorID string) (StorePayoutRecipientReadback, error) {
	partnerActorID = strings.TrimSpace(partnerActorID)
	if db == nil || boundedText(partnerActorID, 1, 128) == "" {
		return StorePayoutRecipientReadback{}, ErrStorePayoutRecipientInvalidInput
	}
	result := StorePayoutRecipientReadback{PartnerActorID: partnerActorID, Currency: "YER", Recipients: []StorePayoutRecipientRecord{}, ReviewStores: []string{}}
	attribution := make(map[string]*StorePayoutRecipientRecord)
	rows, err := db.QueryContext(ctx, `SELECT store_id,order_count,partner_net_minor,last_earning_at FROM wlt.partner_store_earning_attribution WHERE partner_actor_id=$1 ORDER BY store_id`, partnerActorID)
	if err != nil {
		return StorePayoutRecipientReadback{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var record StorePayoutRecipientRecord
		var storeID string
		var last sql.NullTime
		if err := rows.Scan(&storeID, &record.OrderCount, &record.PartnerNetMinor, &last); err != nil {
			return StorePayoutRecipientReadback{}, err
		}
		record.StoreID = storeID
		record.State = StorePayoutRecipientStateDefaultOwner
		if last.Valid {
			copy := last.Time
			record.LastEarningAt = &copy
		}
		copy := record
		attribution[storeID] = &copy
		result.Recipients = append(result.Recipients, record)
	}
	if err := rows.Err(); err != nil {
		return StorePayoutRecipientReadback{}, err
	}
	assignments, err := db.QueryContext(ctx, `SELECT store_id,state,beneficiary_actor_id,version,effective_at FROM wlt.store_payout_recipient_assignments WHERE partner_actor_id=$1 ORDER BY store_id`, partnerActorID)
	if err != nil {
		return StorePayoutRecipientReadback{}, err
	}
	defer assignments.Close()
	for assignments.Next() {
		var storeID, state, beneficiary string
		var version int
		var effective time.Time
		if err := assignments.Scan(&storeID, &state, &beneficiary, &version, &effective); err != nil {
			return StorePayoutRecipientReadback{}, err
		}
		record, exists := attribution[storeID]
		if !exists {
			record = &StorePayoutRecipientRecord{StoreID: storeID}
			result.Recipients = append(result.Recipients, *record)
			attribution[storeID] = record
		}
		for index := range result.Recipients {
			if result.Recipients[index].StoreID == storeID {
				result.Recipients[index].State = state
				result.Recipients[index].BeneficiaryActorID = beneficiary
				result.Recipients[index].Version = version
				copy := effective
				result.Recipients[index].EffectiveAt = &copy
			}
		}
		if state == StorePayoutRecipientStateReviewRequired {
			result.ReviewStores = append(result.ReviewStores, storeID)
		}
	}
	if err := assignments.Err(); err != nil {
		return StorePayoutRecipientReadback{}, err
	}
	return result, nil
}

// enforcePartnerPayoutRecipientReadiness is the Go-side half of the payout readiness
// gate (the constraint trigger is the backstop). It fails closed when any Store
// assignment for the Partner is in RECIPIENT_REVIEW_REQUIRED, and refuses the legacy
// whole-wallet intent when explicit staff routing exists, because a single-recipient
// transfer cannot honor per-Store routing.
func enforcePartnerPayoutRecipientReadiness(ctx context.Context, tx *sql.Tx, partnerActorID string) error {
	rows, err := tx.QueryContext(ctx, "SELECT store_id,state FROM wlt.store_payout_recipient_assignments WHERE partner_actor_id=$1 ORDER BY store_id", partnerActorID)
	if err != nil {
		return err
	}
	defer rows.Close()
	reviewStores := make([]string, 0, 2)
	routingStores := make([]string, 0, 2)
	for rows.Next() {
		var storeID, state string
		if err := rows.Scan(&storeID, &state); err != nil {
			return err
		}
		if state == StorePayoutRecipientStateReviewRequired {
			reviewStores = append(reviewStores, storeID)
		}
		if state == StorePayoutRecipientStateSelectedStaff {
			routingStores = append(routingStores, storeID)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(reviewStores) > 0 {
		return fmt.Errorf("%w: %s", ErrPayoutRecipientReviewRequired, strings.Join(reviewStores, ","))
	}
	if len(routingStores) > 0 {
		return fmt.Errorf("%w: %s", ErrPayoutRecipientRoutingPending, strings.Join(routingStores, ","))
	}
	return nil
}
