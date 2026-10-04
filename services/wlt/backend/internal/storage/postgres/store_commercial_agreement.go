package postgres

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrStoreCommercialAgreementInvalidInput = errors.New("store commercial agreement input is invalid")
	ErrStoreCommercialAgreementNotFound     = errors.New("store commercial agreement was not found")
	ErrStoreCommercialAgreementState        = errors.New("store commercial agreement state does not allow this operation")
	ErrStoreCommercialAgreementVersion      = errors.New("store commercial agreement version is stale")
	ErrStoreCommercialAgreementUnavailable  = errors.New("active store commercial agreement is unavailable")
)

type StoreCommercialAgreementPage struct {
	Agreements []StoreCommercialAgreementRecord
	NextCursor string
}

type StoreCommercialAgreementRate struct {
	FulfillmentMode   string `json:"fulfillmentMode"`
	CommissionRateBps int    `json:"commissionRateBps"`
}

type StoreCommercialAgreementRecord struct {
	AgreementID              string                         `json:"agreementId"`
	StoreID                  string                         `json:"storeId"`
	PartnerActorID           string                         `json:"partnerActorId"`
	AgreementVersion         int                            `json:"agreementVersion"`
	Status                   string                         `json:"status"`
	CreatedAt                time.Time                      `json:"createdAt"`
	Rates                    []StoreCommercialAgreementRate `json:"rates"`
	ProposedByActorID        string                         `json:"proposedByActorId"`
	ProposedAt               time.Time                      `json:"proposedAt"`
	PartnerAcceptedByActorID *string                        `json:"partnerAcceptedByActorId"`
	PartnerAcceptedAt        *time.Time                     `json:"partnerAcceptedAt"`
	FinanceApprovedByActorID *string                        `json:"financeApprovedByActorId"`
	FinanceApprovedAt        *time.Time                     `json:"financeApprovedAt"`
	FinanceDecisionByActorID *string                        `json:"financeDecisionByActorId"`
	FinanceDecisionAt        *time.Time                     `json:"financeDecisionAt"`
	EffectiveAt              *time.Time                     `json:"effectiveAt"`
	SupersededAt             *time.Time                     `json:"supersededAt"`
	Reason                   string                         `json:"reason"`
	FinanceDecisionReason    *string                        `json:"financeDecisionReason"`
}

type ProposeStoreCommercialAgreementInput struct {
	StoreID                string
	PartnerActorID         string
	Rates                  []StoreCommercialAgreementRate
	ExpectedCurrentVersion int
	ActorID                string
	Reason                 string
	IdempotencyKey         string
	CorrelationID          string
}

type StoreCommercialAgreementDecisionInput struct {
	AgreementID     string
	ExpectedVersion int
	Decision        string
	ActorID         string
	Reason          string
	IdempotencyKey  string
	CorrelationID   string
}

func ReadStoreCommercialAgreements(ctx context.Context, db *sql.DB, storeID string) ([]StoreCommercialAgreementRecord, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || boundedText(storeID, 1, 128) == "" {
		return nil, ErrStoreCommercialAgreementInvalidInput
	}
	rows, err := db.QueryContext(ctx, `SELECT agreement_id,store_id,partner_actor_id,agreement_version,status,created_at,proposed_by_actor_id,proposed_at,
		partner_accepted_by_actor_id,partner_accepted_at,finance_approved_by_actor_id,finance_approved_at,finance_decision_by_actor_id,finance_decision_at,effective_at,superseded_at,reason,finance_decision_reason
		FROM wlt.store_commercial_agreements WHERE store_id=$1 ORDER BY agreement_version`, storeID)
	if err != nil {
		return nil, err
	}
	result := make([]StoreCommercialAgreementRecord, 0)
	for rows.Next() {
		item, err := scanStoreCommercialAgreement(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range result {
		if err := readStoreCommercialAgreementRates(ctx, db, &result[index]); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func ListStoreCommercialAgreementsForFinance(ctx context.Context, db *sql.DB, status string, before *time.Time, beforeAgreementID string, limit int) (StoreCommercialAgreementPage, error) {
	status = strings.ToUpper(strings.TrimSpace(status))
	beforeAgreementID = strings.TrimSpace(beforeAgreementID)
	if db == nil || status != "PARTNER_ACCEPTED" || limit < 1 || limit > 50 ||
		((before == nil) != (beforeAgreementID == "")) || (beforeAgreementID != "" && boundedText(beforeAgreementID, 1, 128) == "") {
		return StoreCommercialAgreementPage{}, ErrStoreCommercialAgreementInvalidInput
	}
	rows, err := db.QueryContext(ctx, `SELECT agreement_id,store_id,partner_actor_id,agreement_version,status,created_at,proposed_by_actor_id,proposed_at,
		partner_accepted_by_actor_id,partner_accepted_at,finance_approved_by_actor_id,finance_approved_at,finance_decision_by_actor_id,finance_decision_at,effective_at,superseded_at,reason,finance_decision_reason
		FROM wlt.store_commercial_agreements WHERE status=$1 AND ($2::timestamptz IS NULL OR (created_at,agreement_id)<($2,$3))
		ORDER BY created_at DESC,agreement_id DESC LIMIT $4`, status, before, beforeAgreementID, limit+1)
	if err != nil {
		return StoreCommercialAgreementPage{}, err
	}
	result := StoreCommercialAgreementPage{Agreements: make([]StoreCommercialAgreementRecord, 0, limit)}
	for rows.Next() {
		item, err := scanStoreCommercialAgreement(rows)
		if err != nil {
			_ = rows.Close()
			return StoreCommercialAgreementPage{}, err
		}
		result.Agreements = append(result.Agreements, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return StoreCommercialAgreementPage{}, err
	}
	if err := rows.Close(); err != nil {
		return StoreCommercialAgreementPage{}, err
	}
	if len(result.Agreements) > limit {
		last := result.Agreements[limit-1]
		result.NextCursor = last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + last.AgreementID
		result.Agreements = result.Agreements[:limit]
	}
	for index := range result.Agreements {
		if err := readStoreCommercialAgreementRates(ctx, db, &result.Agreements[index]); err != nil {
			return StoreCommercialAgreementPage{}, err
		}
	}
	return result, nil
}

func ProposeStoreCommercialAgreement(ctx context.Context, db *sql.DB, input ProposeStoreCommercialAgreementInput) (StoreCommercialAgreementRecord, bool, error) {
	input.StoreID, input.PartnerActorID = strings.TrimSpace(input.StoreID), strings.TrimSpace(input.PartnerActorID)
	input.ActorID, input.Reason = strings.TrimSpace(input.ActorID), strings.TrimSpace(input.Reason)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	input.Rates = normalizeAgreementRates(input.Rates)
	if db == nil || boundedText(input.StoreID, 1, 128) == "" || boundedText(input.PartnerActorID, 1, 128) == "" ||
		boundedText(input.ActorID, 1, 128) == "" || input.ExpectedCurrentVersion < 0 ||
		!validStoreCommercialAgreementRates(input.Rates) || utf8.RuneCountInString(input.Reason) < 8 || utf8.RuneCountInString(input.Reason) > 500 ||
		!validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementInvalidInput
	}
	parts := []string{"store-commercial-agreement-proposal-v1", input.StoreID, input.PartnerActorID, input.ActorID, formatInt(input.ExpectedCurrentVersion), input.Reason}
	for _, rate := range input.Rates {
		parts = append(parts, rate.FulfillmentMode, formatInt(rate.CommissionRateBps))
	}
	requestHash := hashFacts(parts...)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:store-commercial-agreement:"+input.StoreID); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if replay, err := readAgreementReplay(ctx, tx, input.IdempotencyKey, "PROPOSED", requestHash); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	} else if replay != "" {
		item, err := readStoreCommercialAgreement(ctx, tx, replay, false)
		if err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
		return item, true, nil
	}
	var currentVersion int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(agreement_version),0) FROM wlt.store_commercial_agreements WHERE store_id=$1", input.StoreID).Scan(&currentVersion); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	var pending bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM wlt.store_commercial_agreements WHERE store_id=$1 AND status IN ('PROPOSED','PARTNER_ACCEPTED'))", input.StoreID).Scan(&pending); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if pending {
		return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementState
	}
	if currentVersion != input.ExpectedCurrentVersion {
		return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementVersion
	}
	agreementID, err := newID("store_agreement")
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.store_commercial_agreements(agreement_id,store_id,partner_actor_id,agreement_version,status,proposed_by_actor_id,reason,idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,'PROPOSED',$5,$6,$7,$8,$9)`, agreementID, input.StoreID, input.PartnerActorID, currentVersion+1, input.ActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	for _, rate := range input.Rates {
		if _, err := tx.ExecContext(ctx, "INSERT INTO wlt.store_commercial_agreement_rates(agreement_id,fulfillment_mode,commission_rate_bps) VALUES($1,$2,$3)", agreementID, rate.FulfillmentMode, rate.CommissionRateBps); err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
	}
	if err := insertStoreCommercialAgreementEvent(ctx, tx, agreementID, "PROPOSED", nil, "PROPOSED", input.ActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	item, err := readStoreCommercialAgreement(ctx, tx, agreementID, false)
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	return item, false, nil
}

func AcceptStoreCommercialAgreement(ctx context.Context, db *sql.DB, agreementID string, expectedVersion int, actorID, reason, idempotencyKey, correlationID string) (StoreCommercialAgreementRecord, bool, error) {
	agreementID, actorID, reason = strings.TrimSpace(agreementID), strings.TrimSpace(actorID), strings.TrimSpace(reason)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || boundedText(agreementID, 1, 128) == "" || boundedText(actorID, 1, 128) == "" || expectedVersion < 1 ||
		boundedText(reason, 8, 500) == "" || !validMutationContext(idempotencyKey, correlationID) {
		return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementInvalidInput
	}
	requestHash := hashFacts("store-commercial-agreement-accept-v1", agreementID, formatInt(expectedVersion), actorID, reason)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if replay, err := readAgreementReplay(ctx, tx, idempotencyKey, "PARTNER_ACCEPTED", requestHash); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	} else if replay != "" {
		item, err := readStoreCommercialAgreement(ctx, tx, replay, false)
		if err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
		return item, true, nil
	}
	item, err := readStoreCommercialAgreement(ctx, tx, agreementID, true)
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if item.Status != "PROPOSED" || item.AgreementVersion != expectedVersion || item.PartnerActorID != actorID {
		if item.AgreementVersion != expectedVersion {
			return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementVersion
		}
		return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementState
	}
	if _, err := tx.ExecContext(ctx, "UPDATE wlt.store_commercial_agreements SET status='PARTNER_ACCEPTED',partner_accepted_by_actor_id=$2,partner_accepted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE agreement_id=$1", agreementID, actorID); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if err := insertStoreCommercialAgreementEvent(ctx, tx, agreementID, "PARTNER_ACCEPTED", stringPointer("PROPOSED"), "PARTNER_ACCEPTED", actorID, reason, idempotencyKey, requestHash, correlationID); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	item, err = readStoreCommercialAgreement(ctx, tx, agreementID, false)
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	return item, false, nil
}

func DecideStoreCommercialAgreement(ctx context.Context, db *sql.DB, input StoreCommercialAgreementDecisionInput) (StoreCommercialAgreementRecord, bool, error) {
	input.AgreementID, input.ActorID = strings.TrimSpace(input.AgreementID), strings.TrimSpace(input.ActorID)
	input.Decision, input.Reason = strings.ToUpper(strings.TrimSpace(input.Decision)), strings.TrimSpace(input.Reason)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.AgreementID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || input.ExpectedVersion < 1 ||
		(input.Decision != "APPROVE" && input.Decision != "REJECT") || boundedText(input.Reason, 8, 500) == "" ||
		!validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementInvalidInput
	}
	requestHash := hashFacts("store-commercial-agreement-finance-decision-v1", input.AgreementID, formatInt(input.ExpectedVersion), input.Decision, input.ActorID, input.Reason)
	eventType := "FINANCE_APPROVED"
	if input.Decision == "REJECT" {
		eventType = "FINANCE_REJECTED"
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if replay, err := readAgreementReplay(ctx, tx, input.IdempotencyKey, eventType, requestHash); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	} else if replay != "" {
		item, err := readStoreCommercialAgreement(ctx, tx, replay, false)
		if err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
		return item, true, nil
	}
	item, err := readStoreCommercialAgreement(ctx, tx, input.AgreementID, true)
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if item.Status != "PARTNER_ACCEPTED" || item.AgreementVersion != input.ExpectedVersion || item.PartnerAcceptedByActorID == nil ||
		input.ActorID == item.ProposedByActorID || input.ActorID == *item.PartnerAcceptedByActorID {
		if item.AgreementVersion != input.ExpectedVersion {
			return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementVersion
		}
		return StoreCommercialAgreementRecord{}, false, ErrStoreCommercialAgreementState
	}
	if input.Decision == "REJECT" {
		if _, err := tx.ExecContext(ctx, `WITH decision AS (SELECT clock_timestamp() AS decided_at)
			UPDATE wlt.store_commercial_agreements AS agreement
			SET status='FINANCE_REJECTED',finance_decision_by_actor_id=$2,finance_decision_at=decision.decided_at,
				finance_decision_reason=$3,updated_at=decision.decided_at
			FROM decision WHERE agreement.agreement_id=$1`, input.AgreementID, input.ActorID, input.Reason); err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
		if err := insertStoreCommercialAgreementEvent(ctx, tx, input.AgreementID, eventType, stringPointer("PARTNER_ACCEPTED"), "FINANCE_REJECTED", input.ActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
	} else {
		var previousID string
		err := tx.QueryRowContext(ctx, "SELECT agreement_id FROM wlt.store_commercial_agreements WHERE store_id=$1 AND status='ACTIVE' FOR UPDATE", item.StoreID).Scan(&previousID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return StoreCommercialAgreementRecord{}, false, err
		}
		if err == nil {
			if _, err := tx.ExecContext(ctx, "UPDATE wlt.store_commercial_agreements SET status='SUPERSEDED',superseded_at=clock_timestamp(),updated_at=clock_timestamp() WHERE agreement_id=$1", previousID); err != nil {
				return StoreCommercialAgreementRecord{}, false, err
			}
			supersedeKey := "supersede-" + hashFacts(input.IdempotencyKey, previousID)[:64]
			if err := insertStoreCommercialAgreementEvent(ctx, tx, previousID, "SUPERSEDED", stringPointer("ACTIVE"), "SUPERSEDED", input.ActorID, "superseded by agreement "+input.AgreementID, supersedeKey, hashFacts("superseded", previousID, input.AgreementID, input.ActorID), input.CorrelationID); err != nil {
				return StoreCommercialAgreementRecord{}, false, err
			}
		}
		if _, err := tx.ExecContext(ctx, `WITH decision AS (SELECT clock_timestamp() AS decided_at)
			UPDATE wlt.store_commercial_agreements AS agreement
			SET status='ACTIVE',finance_approved_by_actor_id=$2,finance_approved_at=decision.decided_at,
				finance_decision_by_actor_id=$2,finance_decision_at=decision.decided_at,effective_at=decision.decided_at,
				finance_decision_reason=$3,updated_at=decision.decided_at
			FROM decision WHERE agreement.agreement_id=$1`, input.AgreementID, input.ActorID, input.Reason); err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
		if err := insertStoreCommercialAgreementEvent(ctx, tx, input.AgreementID, eventType, stringPointer("PARTNER_ACCEPTED"), "ACTIVE", input.ActorID, input.Reason, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
			return StoreCommercialAgreementRecord{}, false, err
		}
	}
	item, err = readStoreCommercialAgreement(ctx, tx, input.AgreementID, false)
	if err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreCommercialAgreementRecord{}, false, err
	}
	return item, false, nil
}

func normalizeAgreementRates(rates []StoreCommercialAgreementRate) []StoreCommercialAgreementRate {
	result := make([]StoreCommercialAgreementRate, len(rates))
	copy(result, rates)
	for index := range result {
		result[index].FulfillmentMode = strings.ToUpper(strings.TrimSpace(result[index].FulfillmentMode))
	}
	sort.Slice(result, func(i, j int) bool { return result[i].FulfillmentMode < result[j].FulfillmentMode })
	return result
}

func validStoreCommercialAgreementRates(rates []StoreCommercialAgreementRate) bool {
	if len(rates) == 0 || len(rates) > len(supportedStoreTypeCommissionModes) {
		return false
	}
	previous := ""
	for _, rate := range rates {
		if !isStoreTypeCommissionMode(rate.FulfillmentMode) || rate.CommissionRateBps < 0 || rate.CommissionRateBps > 10000 || rate.FulfillmentMode == previous {
			return false
		}
		previous = rate.FulfillmentMode
	}
	return true
}

func readAgreementReplay(ctx context.Context, tx *sql.Tx, idempotencyKey, eventType, requestHash string) (string, error) {
	var agreementID, priorType, priorHash string
	err := tx.QueryRowContext(ctx, "SELECT agreement_id,event_type,request_hash FROM wlt.store_commercial_agreement_events WHERE idempotency_key=$1", idempotencyKey).Scan(&agreementID, &priorType, &priorHash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if priorType != eventType || priorHash != requestHash {
		return "", ErrIdempotencyConflict
	}
	return agreementID, nil
}

func insertStoreCommercialAgreementEvent(ctx context.Context, tx *sql.Tx, agreementID, eventType string, fromStatus *string, toStatus, actorID, reason, idempotencyKey, requestHash, correlationID string) error {
	eventID, err := newID("store_agreement_event")
	if err != nil {
		return err
	}
	var from any
	if fromStatus != nil {
		from = *fromStatus
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.store_commercial_agreement_events(id,agreement_id,event_type,from_status,to_status,actor_id,reason,idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, eventID, agreementID, eventType, from, toStatus, actorID, reason, idempotencyKey, requestHash, correlationID)
	return err
}

type agreementScanner interface{ Scan(...any) error }

func scanStoreCommercialAgreement(row agreementScanner) (StoreCommercialAgreementRecord, error) {
	var item StoreCommercialAgreementRecord
	var acceptedBy, approvedBy, decisionBy, decisionReason sql.NullString
	var acceptedAt, approvedAt, decisionAt, effectiveAt, supersededAt sql.NullTime
	err := row.Scan(&item.AgreementID, &item.StoreID, &item.PartnerActorID, &item.AgreementVersion, &item.Status, &item.CreatedAt, &item.ProposedByActorID, &item.ProposedAt,
		&acceptedBy, &acceptedAt, &approvedBy, &approvedAt, &decisionBy, &decisionAt, &effectiveAt, &supersededAt, &item.Reason, &decisionReason)
	if err != nil {
		return StoreCommercialAgreementRecord{}, err
	}
	if acceptedBy.Valid {
		item.PartnerAcceptedByActorID = &acceptedBy.String
	}
	if acceptedAt.Valid {
		value := acceptedAt.Time
		item.PartnerAcceptedAt = &value
	}
	if approvedBy.Valid {
		item.FinanceApprovedByActorID = &approvedBy.String
	}
	if approvedAt.Valid {
		value := approvedAt.Time
		item.FinanceApprovedAt = &value
	}
	if decisionBy.Valid {
		item.FinanceDecisionByActorID = &decisionBy.String
	}
	if decisionAt.Valid {
		value := decisionAt.Time
		item.FinanceDecisionAt = &value
	}
	if effectiveAt.Valid {
		value := effectiveAt.Time
		item.EffectiveAt = &value
	}
	if supersededAt.Valid {
		value := supersededAt.Time
		item.SupersededAt = &value
	}
	if decisionReason.Valid {
		item.FinanceDecisionReason = &decisionReason.String
	}
	return item, nil
}

func readStoreCommercialAgreement(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, agreementID string, forUpdate bool) (StoreCommercialAgreementRecord, error) {
	query := `SELECT agreement_id,store_id,partner_actor_id,agreement_version,status,created_at,proposed_by_actor_id,proposed_at,
		partner_accepted_by_actor_id,partner_accepted_at,finance_approved_by_actor_id,finance_approved_at,finance_decision_by_actor_id,finance_decision_at,effective_at,superseded_at,reason,finance_decision_reason
		FROM wlt.store_commercial_agreements WHERE agreement_id=$1`
	if forUpdate {
		query += " FOR UPDATE"
	}
	item, err := scanStoreCommercialAgreement(source.QueryRowContext(ctx, query, agreementID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreCommercialAgreementRecord{}, ErrStoreCommercialAgreementNotFound
	}
	if err != nil {
		return StoreCommercialAgreementRecord{}, err
	}
	if err := readStoreCommercialAgreementRates(ctx, source, &item); err != nil {
		return StoreCommercialAgreementRecord{}, err
	}
	return item, nil
}

func readStoreCommercialAgreementRates(ctx context.Context, source interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, item *StoreCommercialAgreementRecord) error {
	rows, err := source.QueryContext(ctx, "SELECT fulfillment_mode,commission_rate_bps FROM wlt.store_commercial_agreement_rates WHERE agreement_id=$1 ORDER BY fulfillment_mode", item.AgreementID)
	if err != nil {
		return err
	}
	defer rows.Close()
	item.Rates = make([]StoreCommercialAgreementRate, 0, len(supportedStoreTypeCommissionModes))
	for rows.Next() {
		var rate StoreCommercialAgreementRate
		if err := rows.Scan(&rate.FulfillmentMode, &rate.CommissionRateBps); err != nil {
			return err
		}
		item.Rates = append(item.Rates, rate)
	}
	return rows.Err()
}

func stringPointer(value string) *string { return &value }
