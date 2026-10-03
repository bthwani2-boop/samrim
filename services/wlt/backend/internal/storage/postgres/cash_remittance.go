package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/domain"
)

var (
	ErrRemittanceNotFound     = errors.New("cash remittance was not found")
	ErrRemittanceExists       = errors.New("cash remittance already exists for this payment intent")
	ErrRemittanceIdempotency  = errors.New("cash remittance idempotency key was already used with different facts")
	ErrRemittanceInvalidInput = errors.New("cash remittance input is invalid")
	ErrRemittanceState        = errors.New("cash remittance is not awaiting reconciliation")
	ErrRemittanceSeparation   = errors.New("cash remittance submitter cannot reconcile it")
	ErrRemittanceEvidence     = errors.New("cash remittance requires a finance receipt document")
	ErrRemittanceEvidenceUsed = errors.New("cash remittance transfer receipt is already linked to another transfer")
)

type CashLiability struct {
	PaymentIntentID     string
	ExternalReference   string
	CaptainActorID      string
	AmountMinor         int64
	Currency            string
	PaymentVersion      int
	CollectedAt         time.Time
	RemittanceState     string
	RemittanceReference string
	RemittanceID        string
}

type CashLiabilityList struct {
	Items            []CashLiability
	TotalAmountMinor int64
	TotalItems       int
	HasMore          bool
}

type CashRemittanceRecord struct {
	ID                  string
	PaymentIntentID     string
	CaptainActorID      string
	AmountMinor         int64
	Currency            string
	RemittanceReference string
	State               string
	CreatedAt           time.Time
	ReconciledBy        *string
	ReconciledAt        *time.Time
	ReceiptDocumentID   *string
}

type RemitCashInput struct {
	PaymentIntentID        string
	CaptainActorID         string
	AmountMinor            int64
	RemittanceReference    string
	ExpectedPaymentVersion int
	IdempotencyKey         string
	CorrelationID          string
}

func HashRemitCashRequest(input RemitCashInput) string {
	return hashFacts("cash-remit", input.PaymentIntentID, input.CaptainActorID, fmt.Sprintf("%d", input.AmountMinor), input.RemittanceReference, fmt.Sprintf("%d", input.ExpectedPaymentVersion))
}

func ListCashLiability(ctx context.Context, db *sql.DB, captainActorID string, limit int) (CashLiabilityList, error) {
	captainActorID = strings.TrimSpace(captainActorID)
	if db == nil || captainActorID == "" || limit < 1 || limit > 100 {
		return CashLiabilityList{}, ErrRemittanceInvalidInput
	}
	return listCashLiability(ctx, db, captainActorID, limit)
}

func ListCashLiabilityRegistry(ctx context.Context, db *sql.DB, search, sort string, afterCollectedAt *time.Time, afterPaymentIntentID string, limit int) (CashLiabilityList, error) {
	search = strings.TrimSpace(search)
	sort = strings.TrimSpace(sort)
	afterPaymentIntentID = strings.TrimSpace(afterPaymentIntentID)
	if db == nil || utf8.RuneCountInString(search) > 128 || !validCashLiabilityRegistrySort(sort) || limit < 1 || limit > 100 || (afterCollectedAt == nil) != (afterPaymentIntentID == "") || len(afterPaymentIntentID) > 128 {
		return CashLiabilityList{}, ErrRemittanceInvalidInput
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return CashLiabilityList{}, fmt.Errorf("begin cash custody registry read: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	filter, filterArgs := cashLiabilityRegistryFilter(search)
	var totalItems int
	var totalAmountMinor int64
	summaryQuery := `SELECT COUNT(*), COALESCE(SUM(p.amount_minor), 0) FROM wlt.payment_intents p LEFT JOIN wlt.cash_remittances r ON r.payment_intent_id = p.id ` + filter
	if err := tx.QueryRowContext(ctx, summaryQuery, filterArgs...).Scan(&totalItems, &totalAmountMinor); err != nil {
		return CashLiabilityList{}, fmt.Errorf("summarize cash custody registry: %w", err)
	}

	query, args := cashLiabilityRegistryQuery(filter, filterArgs, sort, afterCollectedAt, afterPaymentIntentID, limit+1)
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return CashLiabilityList{}, fmt.Errorf("list cash custody registry: %w", err)
	}
	defer rows.Close()
	result := CashLiabilityList{Items: make([]CashLiability, 0, limit), TotalAmountMinor: totalAmountMinor, TotalItems: totalItems}
	for rows.Next() {
		var item CashLiability
		if err := rows.Scan(&item.PaymentIntentID, &item.ExternalReference, &item.CaptainActorID, &item.AmountMinor, &item.Currency, &item.PaymentVersion, &item.CollectedAt, &item.RemittanceState, &item.RemittanceReference, &item.RemittanceID); err != nil {
			return CashLiabilityList{}, fmt.Errorf("scan cash custody registry: %w", err)
		}
		if len(result.Items) == limit {
			result.HasMore = true
			break
		}
		result.Items = append(result.Items, item)
	}
	if err := rows.Err(); err != nil {
		return CashLiabilityList{}, fmt.Errorf("iterate cash custody registry: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return CashLiabilityList{}, fmt.Errorf("commit cash custody registry read: %w", err)
	}
	return result, nil
}

func validCashLiabilityRegistrySort(sort string) bool {
	return sort == "collected_asc" || sort == "collected_desc"
}

func cashLiabilityRegistryFilter(search string) (string, []any) {
	filter := `WHERE p.state='COLLECTED' AND p.method=$1 AND (r.id IS NULL OR r.state='SUBMITTED')`
	args := []any{domain.MethodCashOnDelivery}
	if search != "" {
		search = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(search)) + "%"
		args = append(args, search)
		filter += ` AND (lower(p.external_reference) LIKE $2 ESCAPE E'\\' OR lower(p.collected_by_actor_id) LIKE $2 ESCAPE E'\\')`
	}
	return filter, args
}

func cashLiabilityRegistryQuery(filter string, filterArgs []any, sort string, afterCollectedAt *time.Time, afterPaymentIntentID string, limit int) (string, []any) {
	args := append([]any(nil), filterArgs...)
	query := `SELECT p.id, p.external_reference, p.collected_by_actor_id, p.amount_minor, p.currency, p.version, p.collected_at, COALESCE(r.state,'OPEN'), COALESCE(r.remittance_reference,''), COALESCE(r.id,'') FROM wlt.payment_intents p LEFT JOIN wlt.cash_remittances r ON r.payment_intent_id = p.id ` + filter
	if afterCollectedAt != nil {
		operator := ">"
		if sort == "collected_desc" {
			operator = "<"
		}
		args = append(args, *afterCollectedAt, afterPaymentIntentID)
		query += fmt.Sprintf(` AND (p.collected_at, p.id) %s ($%d, $%d)`, operator, len(args)-1, len(args))
	}
	order := "ASC"
	if sort == "collected_desc" {
		order = "DESC"
	}
	args = append(args, limit)
	query += fmt.Sprintf(` ORDER BY p.collected_at %s, p.id %s LIMIT $%d`, order, order, len(args))
	return query, args
}

func cashLiabilityQuery(captainActorID string, limit int) (string, []any) {
	query := `
		SELECT p.id, p.external_reference, p.collected_by_actor_id, p.amount_minor, p.currency, p.version, p.collected_at, COALESCE(r.state,'OPEN'), COALESCE(r.remittance_reference,''), COALESCE(r.id,'')
		FROM wlt.payment_intents p
		LEFT JOIN wlt.cash_remittances r ON r.payment_intent_id = p.id
		WHERE p.state='COLLECTED' AND p.method=$1 AND (r.id IS NULL OR r.state='SUBMITTED')`
	args := []any{domain.MethodCashOnDelivery}
	if captainActorID != "" {
		query += ` AND p.collected_by_actor_id=$2`
		args = append(args, captainActorID)
	}
	query += ` ORDER BY p.collected_at ASC, p.id ASC LIMIT $` + fmt.Sprintf("%d", len(args)+1)
	args = append(args, limit)
	return query, args
}

func listCashLiability(ctx context.Context, db *sql.DB, captainActorID string, limit int) (CashLiabilityList, error) {
	query, args := cashLiabilityQuery(captainActorID, limit)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return CashLiabilityList{}, fmt.Errorf("list cash liability: %w", err)
	}
	defer rows.Close()
	result := CashLiabilityList{Items: make([]CashLiability, 0)}
	for rows.Next() {
		var item CashLiability
		if err := rows.Scan(&item.PaymentIntentID, &item.ExternalReference, &item.CaptainActorID, &item.AmountMinor, &item.Currency, &item.PaymentVersion, &item.CollectedAt, &item.RemittanceState, &item.RemittanceReference, &item.RemittanceID); err != nil {
			return CashLiabilityList{}, fmt.Errorf("scan cash liability: %w", err)
		}
		result.Items = append(result.Items, item)
		result.TotalAmountMinor += item.AmountMinor
	}
	if err := rows.Err(); err != nil {
		return CashLiabilityList{}, fmt.Errorf("iterate cash liability: %w", err)
	}
	return result, nil
}

func matchesCaptainCashRemittance(payment PaymentIntentRecord, input RemitCashInput) bool {
	return payment.Method == domain.MethodCashOnDelivery &&
		payment.State == "COLLECTED" &&
		payment.CollectedByActorID != nil &&
		*payment.CollectedByActorID == input.CaptainActorID &&
		payment.CollectedAmountMinor != nil &&
		*payment.CollectedAmountMinor == input.AmountMinor &&
		payment.Version == input.ExpectedPaymentVersion
}

func RemitCash(ctx context.Context, db *sql.DB, input RemitCashInput) (CashRemittanceRecord, bool, error) {
	input.PaymentIntentID = strings.TrimSpace(input.PaymentIntentID)
	input.CaptainActorID = strings.TrimSpace(input.CaptainActorID)
	input.RemittanceReference = strings.TrimSpace(input.RemittanceReference)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || input.PaymentIntentID == "" || input.CaptainActorID == "" || input.AmountMinor <= 0 || input.ExpectedPaymentVersion < 1 || len(input.RemittanceReference) < 1 || len(input.RemittanceReference) > 128 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return CashRemittanceRecord{}, false, ErrRemittanceInvalidInput
	}
	requestHash := HashRemitCashRequest(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:cash-remit:"+input.IdempotencyKey); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	var storedHash, existingID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,remittance_id FROM wlt.cash_remittance_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &existingID)
	if err == nil {
		if storedHash != requestHash {
			return CashRemittanceRecord{}, false, ErrRemittanceIdempotency
		}
		result, readErr := readCashRemittance(ctx, tx, existingID)
		if readErr != nil {
			return CashRemittanceRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CashRemittanceRecord{}, false, err
		}
		return result, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, false, err
	}
	var payment PaymentIntentRecord
	if err := scanPaymentIntent(tx.QueryRowContext(ctx, `SELECT id,external_reference,payer_actor_id,amount_minor,currency,method,state,version,collected_amount_minor,collected_by_actor_id,collection_reference,collected_at,cancellation_reason,created_at,updated_at FROM wlt.payment_intents WHERE id=$1 FOR UPDATE`, input.PaymentIntentID), &payment); errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, false, ErrNotFound
	} else if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if !matchesCaptainCashRemittance(payment, input) {
		return CashRemittanceRecord{}, false, ErrRemittanceInvalidInput
	}
	var remittanceID, existingCaptainID, existingState string
	err = tx.QueryRowContext(ctx, `SELECT id,captain_actor_id,state FROM wlt.cash_remittances WHERE payment_intent_id=$1 FOR UPDATE`, input.PaymentIntentID).Scan(&remittanceID, &existingCaptainID, &existingState)
	if errors.Is(err, sql.ErrNoRows) {
		remittanceID, err = newID("cash_remit")
		if err != nil {
			return CashRemittanceRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.cash_remittances(id,payment_intent_id,captain_actor_id,amount_minor,currency,remittance_reference,idempotency_key,request_hash,correlation_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUBMITTED')`, remittanceID, input.PaymentIntentID, input.CaptainActorID, input.AmountMinor, payment.Currency, input.RemittanceReference, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
			return CashRemittanceRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.cash_remittance_events(remittance_id,payment_intent_id,event_type,idempotency_key,request_hash,correlation_id,captain_actor_id,amount_minor,remittance_reference) VALUES($1,$2,'CASH_REMITTANCE_SUBMITTED',$3,$4,$5,$6,$7,$8)`, remittanceID, input.PaymentIntentID, input.IdempotencyKey, requestHash, input.CorrelationID, input.CaptainActorID, input.AmountMinor, input.RemittanceReference); err != nil {
			return CashRemittanceRecord{}, false, err
		}
	} else if err != nil {
		return CashRemittanceRecord{}, false, err
	} else {
		if existingState != "SUBMITTED" {
			return CashRemittanceRecord{}, false, ErrRemittanceExists
		}
		if existingCaptainID != input.CaptainActorID {
			return CashRemittanceRecord{}, false, ErrRemittanceInvalidInput
		}
		if _, err := tx.ExecContext(ctx, `UPDATE wlt.cash_remittances SET amount_minor=$2,currency=$3,remittance_reference=$4,request_hash=$5,correlation_id=$6 WHERE id=$1 AND state='SUBMITTED'`, remittanceID, input.AmountMinor, payment.Currency, input.RemittanceReference, requestHash, input.CorrelationID); err != nil {
			return CashRemittanceRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.cash_remittance_events(remittance_id,payment_intent_id,event_type,idempotency_key,request_hash,correlation_id,captain_actor_id,amount_minor,remittance_reference) VALUES($1,$2,'CASH_REMITTANCE_REFERENCE_UPDATED',$3,$4,$5,$6,$7,$8)`, remittanceID, input.PaymentIntentID, input.IdempotencyKey, requestHash, input.CorrelationID, input.CaptainActorID, input.AmountMinor, input.RemittanceReference); err != nil {
			return CashRemittanceRecord{}, false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	result, err := ReadCashRemittance(ctx, db, remittanceID)
	return result, false, err
}

type ReconcileCashRemittanceInput struct {
	RemittanceID       string
	EvidenceDocumentID string
	ActorID            string
	IdempotencyKey     string
	CorrelationID      string
}

func ReconcileCashRemittance(ctx context.Context, db *sql.DB, input ReconcileCashRemittanceInput) (CashRemittanceRecord, bool, error) {
	input.RemittanceID = strings.TrimSpace(input.RemittanceID)
	input.EvidenceDocumentID = strings.TrimSpace(input.EvidenceDocumentID)
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.RemittanceID, 1, 128) == "" || boundedText(input.EvidenceDocumentID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return CashRemittanceRecord{}, false, ErrRemittanceInvalidInput
	}
	hash := hashFacts("cash-remittance-reconciled", input.RemittanceID, input.EvidenceDocumentID, input.ActorID)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:cash-remittance-reconcile:"+input.IdempotencyKey); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	var storedHash, existingRemittanceID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,remittance_id FROM wlt.cash_remittance_events WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &existingRemittanceID)
	if err == nil {
		if storedHash != hash {
			return CashRemittanceRecord{}, false, ErrRemittanceIdempotency
		}
		item, readErr := readCashRemittance(ctx, tx, existingRemittanceID)
		if readErr != nil {
			return CashRemittanceRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CashRemittanceRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, false, err
	}
	var item CashRemittanceRecord
	err = tx.QueryRowContext(ctx, `SELECT id,payment_intent_id,captain_actor_id,amount_minor,currency,remittance_reference,state,created_at FROM wlt.cash_remittances WHERE id=$1 FOR UPDATE`, input.RemittanceID).Scan(&item.ID, &item.PaymentIntentID, &item.CaptainActorID, &item.AmountMinor, &item.Currency, &item.RemittanceReference, &item.State, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, false, ErrRemittanceNotFound
	}
	if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if item.State != "SUBMITTED" {
		return CashRemittanceRecord{}, false, ErrRemittanceState
	}
	if item.CaptainActorID == input.ActorID {
		return CashRemittanceRecord{}, false, ErrRemittanceSeparation
	}
	var evidencePurpose, evidenceUploader string
	err = tx.QueryRowContext(ctx, `SELECT purpose,uploaded_by FROM wlt.finance_evidence_documents WHERE id=$1 FOR SHARE`, input.EvidenceDocumentID).Scan(&evidencePurpose, &evidenceUploader)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (evidencePurpose != "TRANSFER_RECEIPT" || evidenceUploader == item.CaptainActorID)) {
		return CashRemittanceRecord{}, false, ErrRemittanceEvidence
	}
	if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if err := lockCaptainWalletBalance(ctx, tx, item.CaptainActorID); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	// Older remittances predate COD reservations. Their receivable is still
	// reconciled from Finance evidence; only update reservation custody when the
	// canonical reservation exists.
	var reservationID string
	var reservationAmount int64
	var reservationCurrency string
	err = tx.QueryRowContext(ctx, `SELECT id,amount_minor,currency FROM wlt.captain_cod_reservations WHERE payment_intent_id=$1 AND captain_actor_id=$2 AND state='FINALIZED' FOR UPDATE`, item.PaymentIntentID, item.CaptainActorID).Scan(&reservationID, &reservationAmount, &reservationCurrency)
	reservationExists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, false, err
	}
	if reservationExists && (reservationAmount != item.AmountMinor || reservationCurrency != item.Currency) {
		return CashRemittanceRecord{}, false, ErrRemittanceState
	}
	if err := claimFinanceTransferReceipt(ctx, tx, input.EvidenceDocumentID, "CAPTAIN_CASH_REMITTANCE", item.ID); errors.Is(err, ErrFinanceTransferReceiptAlreadyClaimed) {
		return CashRemittanceRecord{}, false, ErrRemittanceEvidenceUsed
	} else if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.cash_remittances SET state='REMITTED',reconciled_by=$2,reconciled_at=clock_timestamp(),receipt_document_id=$3 WHERE id=$1 AND state='SUBMITTED'`, item.ID, input.ActorID, input.EvidenceDocumentID); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.cash_remittance_events(remittance_id,payment_intent_id,event_type,idempotency_key,request_hash,correlation_id,captain_actor_id,amount_minor,remittance_reference,finance_actor_id,evidence_document_id) VALUES($1,$2,'CASH_REMITTANCE_RECONCILED',$3,$4,$5,$6,$7,$8,$9,$10)`, item.ID, item.PaymentIntentID, input.IdempotencyKey, hash, input.CorrelationID, item.CaptainActorID, item.AmountMinor, item.RemittanceReference, input.ActorID, input.EvidenceDocumentID); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	ledgerTransactionID, err := newID("ledger")
	if err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_transactions(id,transaction_type,source_type,source_id,currency,idempotency_key,request_hash,correlation_id) VALUES($1,'CAPTAIN_CASH_REMITTED','CASH_REMITTANCE_RECONCILIATION',$2,$3,$4,$5,$6)`, ledgerTransactionID, item.ID, item.Currency, "cash-remit-reconciled-ledger:"+hashFacts(item.ID), hash, input.CorrelationID); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.ledger_entries(transaction_id,line_sequence,account_class,account_code,actor_type,actor_id,direction,amount_minor,currency) VALUES($1,1,'asset','EXTERNAL_SETTLEMENT_CASH',NULL,NULL,'DEBIT',$2,$3),($1,2,'asset','CAPTAIN_CASH_RECEIVABLE',NULL,NULL,'CREDIT',$2,$3)`, ledgerTransactionID, item.AmountMinor, item.Currency); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	if reservationExists {
		if _, err := tx.ExecContext(ctx, `UPDATE wlt.captain_cod_reservations SET state='REMITTED',remitted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND state='FINALIZED'`, reservationID); err != nil {
			return CashRemittanceRecord{}, false, err
		}
		if err := insertCaptainCODReservationEvent(ctx, tx, reservationID, "CAPTAIN_COD_REMITTED", "captain-cod-remit:"+hashFacts(item.ID), hash, input.CorrelationID); err != nil {
			return CashRemittanceRecord{}, false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return CashRemittanceRecord{}, false, err
	}
	result, err := ReadCashRemittance(ctx, db, item.ID)
	return result, false, err
}

func ReadCashRemittance(ctx context.Context, db *sql.DB, remittanceID string) (CashRemittanceRecord, error) {
	if db == nil || strings.TrimSpace(remittanceID) == "" {
		return CashRemittanceRecord{}, ErrRemittanceInvalidInput
	}
	return readCashRemittance(ctx, db, strings.TrimSpace(remittanceID))
}

func readCashRemittance(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, remittanceID string) (CashRemittanceRecord, error) {
	var result CashRemittanceRecord
	var reconciledBy sql.NullString
	var reconciledAt sql.NullTime
	var evidenceDocumentID sql.NullString
	err := source.QueryRowContext(ctx, `SELECT id,payment_intent_id,captain_actor_id,amount_minor,currency,remittance_reference,state,created_at,reconciled_by,reconciled_at,receipt_document_id FROM wlt.cash_remittances WHERE id=$1`, remittanceID).Scan(&result.ID, &result.PaymentIntentID, &result.CaptainActorID, &result.AmountMinor, &result.Currency, &result.RemittanceReference, &result.State, &result.CreatedAt, &reconciledBy, &reconciledAt, &evidenceDocumentID)
	if errors.Is(err, sql.ErrNoRows) {
		return CashRemittanceRecord{}, ErrRemittanceNotFound
	}
	if reconciledBy.Valid {
		result.ReconciledBy = &reconciledBy.String
	}
	if reconciledAt.Valid {
		result.ReconciledAt = &reconciledAt.Time
	}
	if evidenceDocumentID.Valid {
		result.ReceiptDocumentID = &evidenceDocumentID.String
	}
	return result, err
}
