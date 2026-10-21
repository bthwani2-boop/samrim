package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
)

var (
	ErrSettlementIntakeInvalid  = errors.New("settlement intake is invalid")
	ErrSettlementIntakeOpen     = errors.New("an unsettled request already exists")
	ErrSettlementIntakeNotFound = errors.New("settlement intake was not found")
)

// An intake is an auditable request to Finance, never a payout, hold, or
// transfer. All money must be revalidated when the existing payout path runs.
type SettlementIntakeStore struct {
	StoreID     string `json:"storeId"`
	AmountMinor int64  `json:"amountMinor"`
}
type SettlementIntakeInput struct {
	ActorType      string
	ActorID        string
	RequestedBy    string
	AmountMode     string
	AmountMinor    *int64
	StoreIDs       []string
	StoreAmounts   []SettlementIntakeStore
	IdempotencyKey string
	CorrelationID  string
}
type SettlementIntakeRecord struct {
	ID                   string                  `json:"id"`
	ActorType            string                  `json:"actorType"`
	ActorID              string                  `json:"actorId"`
	RequestedBy          string                  `json:"requestedBy"`
	AmountMode           string                  `json:"amountMode"`
	RequestedAmountMinor *int64                  `json:"requestedAmountMinor,omitempty"`
	ResolvedAmountMinor  int64                   `json:"resolvedAmountMinor"`
	Currency             string                  `json:"currency"`
	StoreAllocations     []SettlementIntakeStore `json:"storeAllocations"`
	Status               string                  `json:"status"`
	PayoutReference      *string                 `json:"payoutReference,omitempty"`
	PayoutStatus         string                  `json:"payoutStatus,omitempty"`
	PayoutUpdatedAt      *time.Time              `json:"payoutUpdatedAt,omitempty"`
	CancellationReason   string                  `json:"cancellationReason,omitempty"`
	CancelledAt          *time.Time              `json:"cancelledAt,omitempty"`
	CreatedAt            time.Time               `json:"createdAt"`
}

func CreateSettlementIntake(ctx context.Context, db *sql.DB, input SettlementIntakeInput) (SettlementIntakeRecord, bool, error) {
	input.ActorType = strings.TrimSpace(strings.ToLower(input.ActorType))
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.RequestedBy = strings.TrimSpace(input.RequestedBy)
	input.AmountMode = strings.TrimSpace(strings.ToUpper(input.AmountMode))
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if input.ActorType == "partner" && input.AmountMode == "SPECIFIED" {
		var sum int64
		for _, entry := range input.StoreAmounts {
			if entry.AmountMinor <= 0 || sum > 9223372036854775807-entry.AmountMinor {
				return SettlementIntakeRecord{}, false, ErrSettlementIntakeInvalid
			}
			sum += entry.AmountMinor
		}
		if input.AmountMinor != nil && *input.AmountMinor != sum {
			return SettlementIntakeRecord{}, false, ErrSettlementIntakeInvalid
		}
		input.AmountMinor = &sum
	}
	if db == nil || (input.ActorType != "field" && input.ActorType != "captain" && input.ActorType != "partner") ||
		boundedText(input.ActorID, 1, 128) == "" || boundedText(input.RequestedBy, 1, 128) == "" ||
		(input.AmountMode != "FULL_AVAILABLE" && input.AmountMode != "SPECIFIED") ||
		boundedText(input.IdempotencyKey, 8, 128) == "" || boundedText(input.CorrelationID, 8, 128) == "" ||
		(input.AmountMode == "SPECIFIED" && (input.AmountMinor == nil || *input.AmountMinor <= 0)) ||
		(input.AmountMode == "FULL_AVAILABLE" && input.AmountMinor != nil) {
		return SettlementIntakeRecord{}, false, ErrSettlementIntakeInvalid
	}
	if input.ActorType != "partner" && (len(input.StoreIDs) > 0 || len(input.StoreAmounts) > 0 || input.RequestedBy != input.ActorID) {
		return SettlementIntakeRecord{}, false, ErrSettlementIntakeInvalid
	}
	requestedIDs := append([]string(nil), input.StoreIDs...)
	sort.Strings(requestedIDs)
	requestedAmounts := append([]SettlementIntakeStore(nil), input.StoreAmounts...)
	sort.Slice(requestedAmounts, func(i, j int) bool { return requestedAmounts[i].StoreID < requestedAmounts[j].StoreID })
	if input.ActorType == "partner" && (len(requestedIDs) == 0 || len(requestedIDs) > 1000 ||
		(input.AmountMode == "SPECIFIED" && len(requestedAmounts) != len(requestedIDs)) ||
		(input.AmountMode == "FULL_AVAILABLE" && len(requestedAmounts) > 0)) {
		return SettlementIntakeRecord{}, false, ErrSettlementIntakeInvalid
	}
	for i, id := range requestedIDs {
		if boundedText(id, 1, 128) == "" || (i > 0 && id == requestedIDs[i-1]) {
			return SettlementIntakeRecord{}, false, ErrSettlementIntakeInvalid
		}
	}
	for i, entry := range requestedAmounts {
		if entry.AmountMinor <= 0 || entry.StoreID != requestedIDs[i] {
			return SettlementIntakeRecord{}, false, ErrSettlementIntakeInvalid
		}
	}
	var amountPart string
	if input.AmountMinor != nil {
		amountPart = formatInt64(*input.AmountMinor)
	}
	facts := []string{"settlement-intake-v1", input.ActorType, input.ActorID, input.RequestedBy, input.AmountMode, amountPart}
	facts = append(facts, requestedIDs...)
	for _, s := range requestedAmounts {
		facts = append(facts, s.StoreID, formatInt64(s.AmountMinor))
	}
	hash := hashFacts(facts...)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementIntakeRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:settlement-intake:"+input.ActorType+":"+input.ActorID); err != nil {
		return SettlementIntakeRecord{}, false, err
	}
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.beneficiary_settlement_intakes WHERE idempotency_key=$1", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != hash {
			return SettlementIntakeRecord{}, false, ErrIdempotencyConflict
		}
		item, e := readSettlementIntake(ctx, tx, existingID)
		if e != nil {
			return SettlementIntakeRecord{}, false, e
		}
		if e = tx.Commit(); e != nil {
			return SettlementIntakeRecord{}, false, e
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SettlementIntakeRecord{}, false, err
	}
	var outstanding string
	err = tx.QueryRowContext(ctx, "SELECT id FROM wlt.beneficiary_settlement_intakes WHERE actor_type=$1 AND actor_id=$2 AND status='REQUESTED'", input.ActorType, input.ActorID).Scan(&outstanding)
	if err == nil {
		return SettlementIntakeRecord{}, false, ErrSettlementIntakeOpen
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SettlementIntakeRecord{}, false, err
	}

	allocations := make([]SettlementIntakeStore, 0)
	var resolved int64
	if input.ActorType == "partner" {
		rows, e := readPartnerStoreFinance(ctx, tx, input.ActorID, requestedIDs)
		if e != nil {
			return SettlementIntakeRecord{}, false, e
		}
		indexed := map[string]PartnerStoreFinanceRecord{}
		for _, row := range rows {
			indexed[row.StoreID] = row
		}
		for i, sid := range requestedIDs {
			row, ok := indexed[sid]
			if !ok || row.PartnerActorID != input.ActorID || !row.AttributionComplete {
				return SettlementIntakeRecord{}, false, ErrPartnerPayoutAttributionGap
			}
			value := row.EligibleAvailableMinor
			if input.AmountMode == "SPECIFIED" {
				value = requestedAmounts[i].AmountMinor
			}
			if value <= 0 || value > row.EligibleAvailableMinor {
				return SettlementIntakeRecord{}, false, ErrPayoutAmountExceeded
			}
			if resolved > 9223372036854775807-value {
				return SettlementIntakeRecord{}, false, ErrSettlementIntakeInvalid
			}
			resolved += value
			allocations = append(allocations, SettlementIntakeStore{StoreID: sid, AmountMinor: value})
		}
	} else {
		var gross, held int64
		account := walletAccountCode(input.ActorType)
		if err = tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0) FROM wlt.ledger_entries WHERE account_code=$1 AND actor_type=$2 AND actor_id=$3", account, input.ActorType, input.ActorID).Scan(&gross); err != nil {
			return SettlementIntakeRecord{}, false, err
		}
		if err = tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(amount_minor),0) FROM wlt.payout_holds WHERE actor_type=$1 AND actor_id=$2 AND status='ACTIVE'", input.ActorType, input.ActorID).Scan(&held); err != nil {
			return SettlementIntakeRecord{}, false, err
		}
		if input.ActorType == "captain" {
			var codHold int64
			if err = tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(amount_minor),0) FROM wlt.captain_cod_reservations WHERE captain_actor_id=$1 AND state IN ('ACTIVE','FINALIZED')", input.ActorID).Scan(&codHold); err != nil {
				return SettlementIntakeRecord{}, false, err
			}
			held += codHold
		}
		eligible := gross - held
		resolved = eligible
		if input.AmountMode == "SPECIFIED" {
			resolved = *input.AmountMinor
		}
		if resolved <= 0 || resolved > eligible {
			return SettlementIntakeRecord{}, false, ErrPayoutAmountExceeded
		}
	}
	id, e := newID("settlement_intake")
	if e != nil {
		return SettlementIntakeRecord{}, false, e
	}
	encoded, e := json.Marshal(allocations)
	if e != nil {
		return SettlementIntakeRecord{}, false, e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO wlt.beneficiary_settlement_intakes
    (id,actor_type,actor_id,requested_by,amount_mode,requested_amount_minor,resolved_amount_minor,store_allocations,idempotency_key,request_hash,correlation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		id, input.ActorType, input.ActorID, input.RequestedBy, input.AmountMode, input.AmountMinor, resolved, encoded, input.IdempotencyKey, hash, input.CorrelationID)
	if e != nil {
		return SettlementIntakeRecord{}, false, e
	}
	item, e := readSettlementIntake(ctx, tx, id)
	if e != nil {
		return SettlementIntakeRecord{}, false, e
	}
	if e = tx.Commit(); e != nil {
		return SettlementIntakeRecord{}, false, e
	}
	return item, false, nil
}

type settlementIntakeReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readSettlementIntake(ctx context.Context, reader settlementIntakeReader, id string) (SettlementIntakeRecord, error) {
	var item SettlementIntakeRecord
	var amount sql.NullInt64
	var payout, cancellationReason sql.NullString
	var cancelledAt sql.NullTime
	var stores []byte
	err := reader.QueryRowContext(ctx, `SELECT id,actor_type,actor_id,requested_by,amount_mode,requested_amount_minor,
    resolved_amount_minor,currency,store_allocations,status,payout_reference,cancellation_reason,cancelled_at,created_at
    FROM wlt.beneficiary_settlement_intakes WHERE id=$1`, id).Scan(
		&item.ID, &item.ActorType, &item.ActorID, &item.RequestedBy, &item.AmountMode, &amount, &item.ResolvedAmountMinor,
		&item.Currency, &stores, &item.Status, &payout, &cancellationReason, &cancelledAt, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrSettlementIntakeNotFound
	}
	if err != nil {
		return item, err
	}
	if amount.Valid {
		item.RequestedAmountMinor = &amount.Int64
	}
	if payout.Valid {
		item.PayoutReference = &payout.String
	}
	if cancellationReason.Valid {
		item.CancellationReason = cancellationReason.String
	}
	if cancelledAt.Valid {
		item.CancelledAt = &cancelledAt.Time
	}
	if err = json.Unmarshal(stores, &item.StoreAllocations); err != nil {
		return item, err
	}
	if payout.Valid && item.Status == "CONVERTED" {
		if item.ActorType == "partner" {
			var count, completed, cancelled int64
			var updated sql.NullTime
			err = reader.QueryRowContext(ctx, `SELECT COUNT(*), COUNT(*) FILTER (WHERE p.status='COMPLETED'),
              COUNT(*) FILTER (WHERE p.status='CANCELLED'), MAX(p.updated_at)
              FROM wlt.partner_payout_request_payouts cp
              JOIN wlt.payout_requests p ON p.id=cp.payout_id WHERE cp.request_id=$1`, payout.String).
				Scan(&count, &completed, &cancelled, &updated)
			if err != nil {
				return item, err
			}
			if count == 0 {
				return item, ErrSettlementIntakeInvalid
			}
			item.PayoutStatus = "IN_PROGRESS"
			if completed == count {
				item.PayoutStatus = "COMPLETED"
			}
			if cancelled == count {
				item.PayoutStatus = "CANCELLED"
			}
			if updated.Valid {
				item.PayoutUpdatedAt = &updated.Time
			}
		} else {
			var updated time.Time
			err = reader.QueryRowContext(ctx, "SELECT status,updated_at FROM wlt.payout_requests WHERE id=$1", payout.String).
				Scan(&item.PayoutStatus, &updated)
			if err != nil {
				return item, err
			}
			item.PayoutUpdatedAt = &updated
		}
	}
	return item, nil
}

// Convert only after the normal WLT payout has verified destinations and held funds.
func ConvertSettlementIntake(ctx context.Context, db *sql.DB, intakeID, payoutReference string) (SettlementIntakeRecord, error) {
	if db == nil || boundedText(strings.TrimSpace(intakeID), 1, 128) == "" || boundedText(strings.TrimSpace(payoutReference), 1, 128) == "" {
		return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementIntakeRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var status, actorType, actorID string
	var amount int64
	var existing sql.NullString
	var storedAllocations []byte
	err = tx.QueryRowContext(ctx, `SELECT status,actor_type,actor_id,resolved_amount_minor,payout_reference,store_allocations
       FROM wlt.beneficiary_settlement_intakes WHERE id=$1 FOR UPDATE`, intakeID).
		Scan(&status, &actorType, &actorID, &amount, &existing, &storedAllocations)
	if errors.Is(err, sql.ErrNoRows) {
		return SettlementIntakeRecord{}, ErrSettlementIntakeNotFound
	}
	if err != nil {
		return SettlementIntakeRecord{}, err
	}
	if status == "CONVERTED" && existing.Valid && existing.String == payoutReference {
		item, e := readSettlementIntake(ctx, tx, intakeID)
		if e != nil {
			return SettlementIntakeRecord{}, e
		}
		return item, tx.Commit()
	}
	if status != "REQUESTED" {
		return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
	}
	var matched bool
	if actorType == "partner" {
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM wlt.partner_payout_requests
        WHERE id=$1 AND partner_actor_id=$2 AND total_amount_minor=$3 AND idempotency_key=$4)`, payoutReference, actorID, amount, "settlement_conv_"+intakeID).Scan(&matched)
	} else {
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM wlt.payout_requests
        WHERE id=$1 AND actor_type=$2 AND actor_id=$3 AND resolved_amount_minor=$4 AND status<>'CANCELLED' AND idempotency_key=$5)`,
			payoutReference, actorType, actorID, amount, "settlement_conv_"+intakeID).Scan(&matched)
	}
	if err != nil {
		return SettlementIntakeRecord{}, err
	}
	if !matched {
		return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
	}
	if actorType == "partner" {
		// The total alone does not prove that the held payout covers the
		// same Stores and amounts as the original beneficiary request.
		var expected []SettlementIntakeStore
		if err := json.Unmarshal(storedAllocations, &expected); err != nil {
			return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
		}
		payout, err := ReadPartnerPayoutRequestTx(ctx, tx, payoutReference)
		if err != nil {
			return SettlementIntakeRecord{}, err
		}
		if len(expected) == 0 || len(expected) != len(payout.Stores) || len(payout.Payouts) == 0 {
			return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
		}
		for i, allocation := range expected {
			if allocation.StoreID != payout.Stores[i].StoreID || allocation.AmountMinor != payout.Stores[i].AmountMinor {
				return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
			}
		}
		for _, child := range payout.Payouts {
			if child.Status == "CANCELLED" {
				return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
			}
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE wlt.beneficiary_settlement_intakes
    SET status='CONVERTED',payout_reference=$2,updated_at=clock_timestamp() WHERE id=$1`, intakeID, payoutReference); err != nil {
		return SettlementIntakeRecord{}, err
	}
	item, err := readSettlementIntake(ctx, tx, intakeID)
	if err != nil {
		return SettlementIntakeRecord{}, err
	}
	return item, tx.Commit()
}

// Cancel an intake with an attributed Finance reason. No hold or posting is
// released: an intake never allocated either in the first place.
func CancelSettlementIntake(ctx context.Context, db *sql.DB, id, actorID, reason string) (SettlementIntakeRecord, error) {
	id, actorID, reason = strings.TrimSpace(id), strings.TrimSpace(actorID), strings.TrimSpace(reason)
	if db == nil || boundedText(id, 1, 128) == "" || boundedText(actorID, 1, 128) == "" || boundedText(reason, 1, 512) == "" {
		return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementIntakeRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var state string
	err = tx.QueryRowContext(ctx, "SELECT status FROM wlt.beneficiary_settlement_intakes WHERE id=$1 FOR UPDATE", id).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return SettlementIntakeRecord{}, ErrSettlementIntakeNotFound
	}
	if err != nil {
		return SettlementIntakeRecord{}, err
	}
	if state == "CONVERTED" {
		return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
	}
	if state == "REQUESTED" {
		_, err = tx.ExecContext(ctx, `UPDATE wlt.beneficiary_settlement_intakes
        SET status='CANCELLED',cancelled_by=$2,cancellation_reason=$3,cancelled_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE id=$1`, id, actorID, reason)
		if err != nil {
			return SettlementIntakeRecord{}, err
		}
	}
	item, err := readSettlementIntake(ctx, tx, id)
	if err != nil {
		return SettlementIntakeRecord{}, err
	}
	return item, tx.Commit()
}

func ReadSettlementIntake(ctx context.Context, db *sql.DB, id string) (SettlementIntakeRecord, error) {
	if db == nil || boundedText(strings.TrimSpace(id), 1, 128) == "" {
		return SettlementIntakeRecord{}, ErrSettlementIntakeInvalid
	}
	return readSettlementIntake(ctx, db, id)
}
func ListSettlementIntakes(ctx context.Context, db *sql.DB, actorType, actorID, status string, limit int) ([]SettlementIntakeRecord, error) {
	if db == nil || limit < 1 || limit > 100 || (status != "" && status != "REQUESTED" && status != "CONVERTED" && status != "CANCELLED") {
		return nil, ErrSettlementIntakeInvalid
	}
	rows, err := db.QueryContext(ctx, `SELECT id FROM wlt.beneficiary_settlement_intakes
        WHERE ($1='' OR actor_type=$1) AND ($2='' OR actor_id=$2) AND ($3='' OR status=$3)
        ORDER BY created_at DESC,id DESC LIMIT $4`, actorType, actorID, status, limit)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, limit)
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			break
		}
		ids = append(ids, id)
	}
	if err == nil {
		err = rows.Err()
	}
	closeErr := rows.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	items := make([]SettlementIntakeRecord, 0, len(ids))
	for _, id := range ids {
		item, e := ReadSettlementIntake(ctx, db, id)
		if e != nil {
			return nil, e
		}
		items = append(items, item)
	}
	return items, nil
}
