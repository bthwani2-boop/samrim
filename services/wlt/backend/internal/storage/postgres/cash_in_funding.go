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
	ErrFundingIntentNotFound = errors.New("cash-in funding intent was not found")
	ErrFundingIntentState    = errors.New("cash-in funding intent does not allow this result")
	ErrFundingUnavailable    = errors.New("cash-in is unavailable because no approved provider rail is configured")
	ErrFundingActor          = errors.New("actor is not admitted for cash-in")
)

const DevelopmentSimulatorProvider = "DEVELOPMENT_SIMULATOR"

type CashInFundingIntentRecord struct {
	ID                           string
	ActorType                    string
	ActorID                      string
	FundingPurpose               string
	ProviderKey                  string
	ExternalReference            string
	RequestedAmountMinor         int64
	Currency                     string
	State                        string
	Version                      int
	ProviderReference            *string
	ProviderTransactionReference *string
	LedgerTransactionID          *string
	CreatedAt                    time.Time
	UpdatedAt                    time.Time
}

type CreateCashInFundingIntentInput struct {
	ActorType      string
	ActorID        string
	AmountMinor    int64
	Currency       string
	ProviderKey    string
	IdempotencyKey string
	CorrelationID  string
}

type ApplyCashInFundingResultInput struct {
	FundingIntentID              string
	Outcome                      string
	ProviderTransactionReference string
	ActorID                      string
	IdempotencyKey               string
	CorrelationID                string
}

func AttachCashInProviderReference(ctx context.Context, db *sql.DB, fundingIntentID, providerReference string) (CashInFundingIntentRecord, error) {
	fundingIntentID, providerReference = strings.TrimSpace(fundingIntentID), strings.TrimSpace(providerReference)
	if db == nil || boundedText(fundingIntentID, 1, 128) == "" || boundedText(providerReference, 1, 160) == "" {
		return CashInFundingIntentRecord{}, ErrInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CashInFundingIntentRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var current sql.NullString
	var state string
	if err := tx.QueryRowContext(ctx, `SELECT provider_reference,state FROM wlt.cash_in_funding_intents WHERE id=$1 FOR UPDATE`, fundingIntentID).Scan(&current, &state); errors.Is(err, sql.ErrNoRows) {
		return CashInFundingIntentRecord{}, ErrFundingIntentNotFound
	} else if err != nil {
		return CashInFundingIntentRecord{}, err
	}
	if state != "PENDING_PROVIDER" && state != "UNKNOWN" {
		return CashInFundingIntentRecord{}, ErrFundingIntentState
	}
	if current.Valid && current.String != providerReference {
		return CashInFundingIntentRecord{}, ErrIdempotencyConflict
	}
	if !current.Valid {
		if _, err := tx.ExecContext(ctx, `UPDATE wlt.cash_in_funding_intents SET provider_reference=$2,updated_at=clock_timestamp() WHERE id=$1`, fundingIntentID, providerReference); err != nil {
			return CashInFundingIntentRecord{}, err
		}
	}
	item, err := readCashInFundingIntent(ctx, tx, fundingIntentID)
	if err != nil {
		return CashInFundingIntentRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return CashInFundingIntentRecord{}, err
	}
	return item, nil
}

func CreateCashInFundingIntent(ctx context.Context, db *sql.DB, input CreateCashInFundingIntentInput) (CashInFundingIntentRecord, bool, error) {
	input.ActorType = strings.ToLower(strings.TrimSpace(input.ActorType))
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.ProviderKey = strings.ToUpper(strings.TrimSpace(input.ProviderKey))
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || (input.ActorType != "customer" && input.ActorType != "captain") || boundedText(input.ActorID, 1, 128) == "" || input.AmountMinor <= 0 || input.Currency != "YER" || boundedText(input.ProviderKey, 1, 64) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return CashInFundingIntentRecord{}, false, ErrInvalidInput
	}
	requestHash := hashFacts("cash-in-funding-intent", input.ActorType, input.ActorID, fmt.Sprintf("%d", input.AmountMinor), input.Currency, input.ProviderKey)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:cash-in:"+input.IdempotencyKey); err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.cash_in_funding_intents WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return CashInFundingIntentRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readCashInFundingIntent(ctx, tx, existingID)
		if readErr != nil {
			return CashInFundingIntentRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CashInFundingIntentRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CashInFundingIntentRecord{}, false, err
	}
	id, err := newID("funding")
	if err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	externalReference, err := newID("external-funding")
	if err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	purpose := "CUSTOMER_TOPUP"
	if input.ActorType == "captain" {
		purpose = "CAPTAIN_TOPUP"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.cash_in_funding_intents(id,actor_type,actor_id,funding_purpose,provider_key,external_reference,requested_amount_minor,currency,state,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING_PROVIDER',$9,$10,$11)`, id, input.ActorType, input.ActorID, purpose, input.ProviderKey, externalReference, input.AmountMinor, input.Currency, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	if err := insertCashInFundingEvent(ctx, tx, id, "FUNDING_INTENT_CREATED", "PENDING_PROVIDER", "", input.IdempotencyKey+"-created", requestHash, input.CorrelationID); err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	item, err := readCashInFundingIntent(ctx, tx, id)
	if err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	return item, false, nil
}

func ApplyCashInFundingResult(ctx context.Context, db *sql.DB, input ApplyCashInFundingResultInput) (CashInFundingIntentRecord, bool, error) {
	input.FundingIntentID = strings.TrimSpace(input.FundingIntentID)
	input.Outcome = strings.ToUpper(strings.TrimSpace(input.Outcome))
	input.ProviderTransactionReference = strings.TrimSpace(input.ProviderTransactionReference)
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.FundingIntentID, 1, 128) == "" || (input.Outcome != "SUCCESS" && input.Outcome != "FAILURE" && input.Outcome != "UNKNOWN" && input.Outcome != "DELAYED") || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) || (input.Outcome == "SUCCESS" && boundedText(input.ProviderTransactionReference, 1, 160) == "") {
		return CashInFundingIntentRecord{}, false, ErrInvalidInput
	}
	requestHash := hashFacts("cash-in-result", input.FundingIntentID, input.Outcome, input.ProviderTransactionReference, input.ActorID)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:cash-in-result:"+input.IdempotencyKey); err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	var priorID, priorHash string
	err = tx.QueryRowContext(ctx, "SELECT funding_intent_id,request_hash FROM wlt.cash_in_funding_intent_events WHERE idempotency_key=$1", input.IdempotencyKey).Scan(&priorID, &priorHash)
	if err == nil {
		if priorID != input.FundingIntentID || priorHash != requestHash {
			return CashInFundingIntentRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readCashInFundingIntent(ctx, tx, input.FundingIntentID)
		if readErr != nil {
			return CashInFundingIntentRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CashInFundingIntentRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CashInFundingIntentRecord{}, false, err
	}
	var item CashInFundingIntentRecord
	err = scanCashInFundingIntent(ctx, tx, input.FundingIntentID, true, &item)
	if errors.Is(err, sql.ErrNoRows) {
		return CashInFundingIntentRecord{}, false, ErrFundingIntentNotFound
	}
	if err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	if item.State != "PENDING_PROVIDER" && item.State != "UNKNOWN" {
		return CashInFundingIntentRecord{}, false, ErrFundingIntentState
	}
	newState, eventType := item.State, ""
	switch input.Outcome {
	case "DELAYED":
		eventType = "PROVIDER_RESULT_DELAYED"
	case "UNKNOWN":
		newState, eventType = "UNKNOWN", "PROVIDER_RESULT_UNKNOWN"
	case "FAILURE":
		newState, eventType = "FAILED", "PROVIDER_RESULT_FAILED"
	case "SUCCESS":
		newState, eventType = "SETTLED", "PROVIDER_RESULT_CONFIRMED"
	}
	if input.Outcome == "SUCCESS" {
		ledgerID, err := newID("ledger")
		if err != nil {
			return CashInFundingIntentRecord{}, false, err
		}
		transactionType := "CUSTOMER_WALLET_TOPUP"
		walletCode, walletActorType := "CUSTOMER_WALLET", "customer"
		if item.ActorType == "captain" {
			transactionType, walletCode, walletActorType = "CAPTAIN_TOPUP", "CAPTAIN_WALLET", "captain"
		}
		ledgerHash := hashFacts("cash-in-ledger", requestHash, item.ID, item.ActorID, fmt.Sprintf("%d", item.RequestedAmountMinor), item.Currency)
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,$2,'FUNDING_INTENT',$3,$4,$5,$6,$7)`, ledgerID, transactionType, item.ID, item.Currency, input.IdempotencyKey+"-ledger", ledgerHash, input.CorrelationID); err != nil {
			return CashInFundingIntentRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,direction,amount_minor,currency) VALUES($1,1,'asset','EXTERNAL_SETTLEMENT_CASH','DEBIT',$2,$3)`, ledgerID, item.RequestedAmountMinor, item.Currency); err != nil {
			return CashInFundingIntentRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,2,'liability',$2,$3,$4,'CREDIT',$5,$6)`, ledgerID, walletCode, walletActorType, item.ActorID, item.RequestedAmountMinor, item.Currency); err != nil {
			return CashInFundingIntentRecord{}, false, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE wlt.cash_in_funding_intents SET state='SETTLED',provider_transaction_reference=$2,ledger_transaction_id=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1`, item.ID, input.ProviderTransactionReference, ledgerID)
		if err != nil {
			return CashInFundingIntentRecord{}, false, err
		}
	} else if input.Outcome != "DELAYED" {
		if _, err := tx.ExecContext(ctx, `UPDATE wlt.cash_in_funding_intents SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1`, item.ID, newState); err != nil {
			return CashInFundingIntentRecord{}, false, err
		}
	}
	if err := insertCashInFundingEvent(ctx, tx, item.ID, eventType, newState, input.ProviderTransactionReference, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	item, err = readCashInFundingIntent(ctx, tx, item.ID)
	if err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CashInFundingIntentRecord{}, false, err
	}
	return item, false, nil
}

func ReadWalletBalance(ctx context.Context, db *sql.DB, actorType, actorID string) (int64, error) {
	actorType, actorID = strings.ToLower(strings.TrimSpace(actorType)), strings.TrimSpace(actorID)
	if db == nil || (actorType != "customer" && actorType != "captain") || boundedText(actorID, 1, 128) == "" {
		return 0, ErrInvalidInput
	}
	accountCode := "CUSTOMER_WALLET"
	if actorType == "captain" {
		accountCode = "CAPTAIN_WALLET"
	}
	var balance int64
	err := db.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END),0) FROM wlt.ledger_entries WHERE account_code=$1 AND actor_type=$2 AND actor_id=$3`, accountCode, actorType, actorID).Scan(&balance)
	if err != nil {
		return 0, err
	}
	return balance, nil
}

func ListCashInFundingIntents(ctx context.Context, db *sql.DB, actorType, actorID string, limit int) ([]CashInFundingIntentRecord, error) {
	actorType, actorID = strings.ToLower(strings.TrimSpace(actorType)), strings.TrimSpace(actorID)
	if db == nil || (actorType != "customer" && actorType != "captain") || boundedText(actorID, 1, 128) == "" {
		return nil, ErrInvalidInput
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := db.QueryContext(ctx, `SELECT id,actor_type,actor_id,funding_purpose,provider_key,external_reference,requested_amount_minor,currency,state,version,provider_reference,provider_transaction_reference,ledger_transaction_id,created_at,updated_at FROM wlt.cash_in_funding_intents WHERE actor_type=$1 AND actor_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3`, actorType, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]CashInFundingIntentRecord, 0)
	for rows.Next() {
		var item CashInFundingIntentRecord
		if err := rows.Scan(&item.ID, &item.ActorType, &item.ActorID, &item.FundingPurpose, &item.ProviderKey, &item.ExternalReference, &item.RequestedAmountMinor, &item.Currency, &item.State, &item.Version, &item.ProviderReference, &item.ProviderTransactionReference, &item.LedgerTransactionID, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func readCashInFundingIntent(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string) (CashInFundingIntentRecord, error) {
	var item CashInFundingIntentRecord
	err := scanCashInFundingIntent(ctx, source, id, false, &item)
	if errors.Is(err, sql.ErrNoRows) {
		return CashInFundingIntentRecord{}, ErrFundingIntentNotFound
	}
	return item, err
}

func scanCashInFundingIntent(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id string, forUpdate bool, item *CashInFundingIntentRecord) error {
	query := `SELECT id,actor_type,actor_id,funding_purpose,provider_key,external_reference,requested_amount_minor,currency,state,version,provider_reference,provider_transaction_reference,ledger_transaction_id,created_at,updated_at FROM wlt.cash_in_funding_intents WHERE id=$1`
	if forUpdate {
		query += " FOR UPDATE"
	}
	return source.QueryRowContext(ctx, query, id).Scan(&item.ID, &item.ActorType, &item.ActorID, &item.FundingPurpose, &item.ProviderKey, &item.ExternalReference, &item.RequestedAmountMinor, &item.Currency, &item.State, &item.Version, &item.ProviderReference, &item.ProviderTransactionReference, &item.LedgerTransactionID, &item.CreatedAt, &item.UpdatedAt)
}

func ReadCashInFundingIntent(ctx context.Context, db *sql.DB, id string) (CashInFundingIntentRecord, error) {
	if db == nil || boundedText(strings.TrimSpace(id), 1, 128) == "" {
		return CashInFundingIntentRecord{}, ErrInvalidInput
	}
	return readCashInFundingIntent(ctx, db, strings.TrimSpace(id))
}

func insertCashInFundingEvent(ctx context.Context, tx *sql.Tx, fundingIntentID, eventType, resultingState, providerReference, idempotencyKey, requestHash, correlationID string) error {
	id, err := newID("funding-event")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.cash_in_funding_intent_events(id,funding_intent_id,event_type,provider_transaction_reference,resulting_state,request_hash,idempotency_key,correlation_id) VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8)`, id, fundingIntentID, eventType, providerReference, resultingState, requestHash, idempotencyKey, correlationID)
	return err
}
