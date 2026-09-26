package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

var ErrFinanceEvidenceNotFound = errors.New("finance evidence document was not found")

type FinanceEvidenceDocumentInput struct {
	Purpose        string
	Filename       string
	ContentType    string
	Content        []byte
	ActorID        string
	IdempotencyKey string
	CorrelationID  string
}

type FinanceEvidenceDocumentRecord struct {
	ID          string
	Purpose     string
	Filename    string
	ContentType string
	SHA256      string
	SizeBytes   int64
	UploadedBy  string
	CreatedAt   time.Time
	Content     []byte
}

func SaveFinanceEvidenceDocument(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input FinanceEvidenceDocumentInput) (FinanceEvidenceDocumentRecord, error) {
	input.Purpose = strings.ToUpper(strings.TrimSpace(input.Purpose))
	input.Filename = strings.TrimSpace(input.Filename)
	input.ContentType = strings.ToLower(strings.TrimSpace(input.ContentType))
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || cipher == nil || !validEvidencePurpose(input.Purpose) || boundedText(input.Filename, 1, 255) == "" || !validEvidenceContentType(input.ContentType) || len(input.Content) == 0 || len(input.Content) > 10*1024*1024 || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return FinanceEvidenceDocumentRecord{}, ErrSettlementBatchInput
	}
	digest := sha256.Sum256(input.Content)
	sha := hex.EncodeToString(digest[:])
	requestHash := hashFacts("finance-evidence-document", input.Purpose, input.Filename, input.ContentType, sha, input.ActorID)
	ciphertext, err := cipher.EncryptBytes(input.Content)
	if err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var id, priorHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.finance_evidence_documents WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&id, &priorHash)
	if err == nil {
		if priorHash != requestHash {
			return FinanceEvidenceDocumentRecord{}, ErrIdempotencyConflict
		}
		item, readErr := readFinanceEvidenceDocument(ctx, tx, cipher, id, true)
		if readErr != nil {
			return FinanceEvidenceDocumentRecord{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return FinanceEvidenceDocumentRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FinanceEvidenceDocumentRecord{}, err
	}
	id, err = newID("finance-evidence")
	if err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.finance_evidence_documents(id,purpose,original_filename,content_type,content_sha256,content_ciphertext,content_size_bytes,uploaded_by,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, input.Purpose, input.Filename, input.ContentType, sha, ciphertext, len(input.Content), input.ActorID, input.IdempotencyKey, requestHash, input.CorrelationID)
	if err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "FINANCE_EVIDENCE_UPLOADED", "", "", input.ActorID, input.Purpose, id, input.IdempotencyKey+"-audit", requestHash, input.CorrelationID); err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	item := FinanceEvidenceDocumentRecord{ID: id, Purpose: input.Purpose, Filename: input.Filename, ContentType: input.ContentType, SHA256: sha, SizeBytes: int64(len(input.Content)), UploadedBy: input.ActorID, CreatedAt: time.Now().UTC()}
	if err := tx.QueryRowContext(ctx, "SELECT created_at FROM wlt.finance_evidence_documents WHERE id=$1", id).Scan(&item.CreatedAt); err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	return item, nil
}

func ReadFinanceEvidenceDocument(ctx context.Context, db *sql.DB, cipher *DestinationCipher, id string) (FinanceEvidenceDocumentRecord, error) {
	if db == nil || cipher == nil || boundedText(strings.TrimSpace(id), 1, 128) == "" {
		return FinanceEvidenceDocumentRecord{}, ErrSettlementBatchInput
	}
	return readFinanceEvidenceDocument(ctx, db, cipher, strings.TrimSpace(id), true)
}

func ReadFinanceEvidenceDocumentForOperator(ctx context.Context, db *sql.DB, cipher *DestinationCipher, id, actorID, correlationID string) (FinanceEvidenceDocumentRecord, error) {
	id, actorID, correlationID = strings.TrimSpace(id), strings.TrimSpace(actorID), strings.TrimSpace(correlationID)
	if db == nil || cipher == nil || boundedText(id, 1, 128) == "" || boundedText(actorID, 1, 128) == "" {
		return FinanceEvidenceDocumentRecord{}, ErrSettlementBatchInput
	}
	if correlationID == "" {
		generated, genErr := newID("finance-read")
		if genErr != nil {
			return FinanceEvidenceDocumentRecord{}, genErr
		}
		correlationID = generated
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	item, err := readFinanceEvidenceDocument(ctx, tx, cipher, id, true)
	if err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	var payoutID, batchID sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT
		(SELECT e.payout_id FROM wlt.manual_transfer_executions e WHERE e.receipt_document_id=$1),
		COALESCE((SELECT e.batch_id FROM wlt.manual_transfer_executions e WHERE e.receipt_document_id=$1),
		         (SELECT s.batch_id FROM wlt.settlement_statements s WHERE s.evidence_document_id=$1),
		         (SELECT x.batch_id FROM wlt.settlement_batch_exports x WHERE x.evidence_document_id=$1))`, id).Scan(&payoutID, &batchID); err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	key, err := newID("finance-download")
	if err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	requestHash := hashFacts("finance-evidence-download", id, actorID, item.SHA256, correlationID, time.Now().UTC().Format(time.RFC3339Nano))
	if err := insertPayoutAudit(ctx, tx, "FINANCE_EVIDENCE_DOWNLOADED", payoutID.String, batchID.String, actorID, item.Purpose, id, key, requestHash, correlationID); err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	return item, nil
}

func readFinanceEvidenceDocument(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, cipher *DestinationCipher, id string, includeContent bool) (FinanceEvidenceDocumentRecord, error) {
	var item FinanceEvidenceDocumentRecord
	var ciphertext []byte
	err := source.QueryRowContext(ctx, `SELECT id,purpose,original_filename,content_type,content_sha256,content_ciphertext,content_size_bytes,uploaded_by,created_at FROM wlt.finance_evidence_documents WHERE id=$1`, id).Scan(&item.ID, &item.Purpose, &item.Filename, &item.ContentType, &item.SHA256, &ciphertext, &item.SizeBytes, &item.UploadedBy, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FinanceEvidenceDocumentRecord{}, ErrFinanceEvidenceNotFound
	}
	if err != nil {
		return FinanceEvidenceDocumentRecord{}, err
	}
	if includeContent {
		item.Content, err = cipher.DecryptBytes(ciphertext)
		if err != nil {
			return FinanceEvidenceDocumentRecord{}, err
		}
	}
	return item, nil
}

func validEvidencePurpose(value string) bool {
	return value == "TRANSFER_RECEIPT" || value == "SETTLEMENT_STATEMENT" || value == "SETTLEMENT_BATCH_EXPORT" || value == "CUSTOMER_WITHDRAWAL_REQUEST"
}

func validEvidenceContentType(value string) bool {
	switch value {
	case "application/pdf", "image/jpeg", "image/png", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return true
	default:
		return false
	}
}
