package postgres

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"strconv"
	"strings"
)

type ExportSettlementBatchInput struct {
	BatchID        string
	ActorID        string
	IdempotencyKey string
	CorrelationID  string
}

type SettlementBatchExportRecord struct {
	ID                 string
	BatchID            string
	EvidenceDocumentID string
	Filename           string
	ContentType        string
	SHA256             string
	SizeBytes          int64
	RowCount           int
	TotalAmountMinor   int64
	Currency           string
	GeneratedBy        string
	CreatedAt          string
	Content            []byte
}

var ErrSettlementBatchExportState = errors.New("only an approved frozen settlement batch can be exported")

func ExportSettlementBatch(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input ExportSettlementBatchInput) (SettlementBatchExportRecord, error) {
	input.BatchID = strings.TrimSpace(input.BatchID)
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || cipher == nil || boundedText(input.BatchID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return SettlementBatchExportRecord{}, ErrSettlementBatchInput
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return SettlementBatchExportRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var batchHash string
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(batch_hash,'') FROM wlt.settlement_batches WHERE id=$1 FOR UPDATE", input.BatchID).Scan(&batchHash); errors.Is(err, sql.ErrNoRows) {
		return SettlementBatchExportRecord{}, ErrSettlementBatchNotFound
	} else if err != nil {
		return SettlementBatchExportRecord{}, err
	}
	requestHash := hashFacts("settlement-batch-export", input.BatchID, input.ActorID, batchHash)
	var priorID string
	err = tx.QueryRowContext(ctx, "SELECT id FROM wlt.settlement_batch_exports WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&priorID)
	if err == nil {
		var item SettlementBatchExportRecord
		var createdAt sql.NullString
		err = tx.QueryRowContext(ctx, `SELECT e.id,e.batch_id,e.evidence_document_id,d.original_filename,d.content_type,e.file_sha256,d.content_size_bytes,e.row_count,e.total_amount_minor,e.currency,e.generated_by,e.created_at::text FROM wlt.settlement_batch_exports e JOIN wlt.finance_evidence_documents d ON d.id=e.evidence_document_id WHERE e.id=$1`, priorID).Scan(&item.ID, &item.BatchID, &item.EvidenceDocumentID, &item.Filename, &item.ContentType, &item.SHA256, &item.SizeBytes, &item.RowCount, &item.TotalAmountMinor, &item.Currency, &item.GeneratedBy, &createdAt)
		if err != nil {
			return SettlementBatchExportRecord{}, err
		}
		if item.BatchID != input.BatchID {
			return SettlementBatchExportRecord{}, ErrIdempotencyConflict
		}
		var priorHash string
		if err := tx.QueryRowContext(ctx, "SELECT request_hash FROM wlt.settlement_batch_exports WHERE id=$1", priorID).Scan(&priorHash); err != nil {
			return SettlementBatchExportRecord{}, err
		}
		if priorHash != requestHash {
			return SettlementBatchExportRecord{}, ErrIdempotencyConflict
		}
		item.CreatedAt = createdAt.String
		if err := tx.Commit(); err != nil {
			return SettlementBatchExportRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SettlementBatchExportRecord{}, err
	}

	batch, err := readSettlementBatch(ctx, tx, input.BatchID)
	if err != nil {
		return SettlementBatchExportRecord{}, err
	}
	if batch.Status != "FROZEN" && batch.Status != "EXECUTION_IN_PROGRESS" && batch.Status != "AWAITING_VERIFICATION" && batch.Status != "AWAITING_RECONCILIATION" && batch.Status != "COMPLETED" {
		return SettlementBatchExportRecord{}, ErrSettlementBatchExportState
	}
	if len(batch.Items) == 0 || batch.RowCount != len(batch.Items) || batch.TotalAmountMinor <= 0 || batch.Currency != "YER" || strings.TrimSpace(batch.BatchHash) == "" {
		return SettlementBatchExportRecord{}, ErrSettlementBatchInput
	}

	rows := make([][]string, 0, len(batch.Items)+1)
	rows = append(rows, []string{"row_sequence", "batch_id", "payout_id", "beneficiary", "actor_type", "provider", "wallet_identifier", "amount_minor", "currency", "approved_snapshot_hash"})
	for index, item := range batch.Items {
		var beneficiary, provider, destinationID, snapshotHash string
		var destinationVersion int
		if err := tx.QueryRowContext(ctx, `SELECT beneficiary_name,provider_key,destination_id,destination_version,snapshot_hash FROM wlt.approved_payout_snapshots WHERE payout_id=$1`, item.PayoutID).Scan(&beneficiary, &provider, &destinationID, &destinationVersion, &snapshotHash); err != nil {
			return SettlementBatchExportRecord{}, err
		}
		var encrypted string
		if err := tx.QueryRowContext(ctx, `SELECT wallet_identifier_ciphertext FROM wlt.official_wallet_destinations WHERE id=$1 AND version=$2 AND actor_type=$3 AND actor_id=$4`, destinationID, destinationVersion, item.ActorType, item.ActorID).Scan(&encrypted); err != nil {
			return SettlementBatchExportRecord{}, err
		}
		walletIdentifier, err := cipher.decrypt(encrypted)
		if err != nil {
			return SettlementBatchExportRecord{}, err
		}
		rows = append(rows, []string{strconv.Itoa(index + 1), batch.ID, item.PayoutID, beneficiary, item.ActorType, provider, walletIdentifier, strconv.FormatInt(item.AmountMinor, 10), item.Currency, snapshotHash})
	}
	content, err := buildSettlementBatchXLSX(rows)
	if err != nil {
		return SettlementBatchExportRecord{}, err
	}
	fileDigest := sha256.Sum256(content)
	fileSHA := hex.EncodeToString(fileDigest[:])
	ciphertext, err := cipher.EncryptBytes(content)
	if err != nil {
		return SettlementBatchExportRecord{}, err
	}
	documentID, err := newID("finance-evidence")
	if err != nil {
		return SettlementBatchExportRecord{}, err
	}
	exportID, err := newID("settlement-export")
	if err != nil {
		return SettlementBatchExportRecord{}, err
	}
	filename := "settlement-batch-" + safeArtifactName(batch.ID) + ".xlsx"
	const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.finance_evidence_documents(id,purpose,original_filename,content_type,content_sha256,content_ciphertext,content_size_bytes,uploaded_by,idempotency_key,request_hash,correlation_id) VALUES($1,'SETTLEMENT_BATCH_EXPORT',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, documentID, filename, contentType, fileSHA, ciphertext, len(content), input.ActorID, hashFacts(input.IdempotencyKey, "document"), requestHash, input.CorrelationID); err != nil {
		return SettlementBatchExportRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.settlement_batch_exports(id,batch_id,evidence_document_id,generated_by,row_count,total_amount_minor,currency,file_sha256,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, exportID, batch.ID, documentID, input.ActorID, batch.RowCount, batch.TotalAmountMinor, batch.Currency, fileSHA, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return SettlementBatchExportRecord{}, err
	}
	if err := insertPayoutAudit(ctx, tx, "SETTLEMENT_BATCH_EXPORTED", "", batch.ID, input.ActorID, "GENERATED_XLSX", documentID, hashFacts(input.IdempotencyKey, "audit"), requestHash, input.CorrelationID); err != nil {
		return SettlementBatchExportRecord{}, err
	}
	var item SettlementBatchExportRecord
	err = tx.QueryRowContext(ctx, `SELECT e.id,e.batch_id,e.evidence_document_id,d.original_filename,d.content_type,e.file_sha256,d.content_size_bytes,e.row_count,e.total_amount_minor,e.currency,e.generated_by,e.created_at::text FROM wlt.settlement_batch_exports e JOIN wlt.finance_evidence_documents d ON d.id=e.evidence_document_id WHERE e.id=$1`, exportID).Scan(&item.ID, &item.BatchID, &item.EvidenceDocumentID, &item.Filename, &item.ContentType, &item.SHA256, &item.SizeBytes, &item.RowCount, &item.TotalAmountMinor, &item.Currency, &item.GeneratedBy, &item.CreatedAt)
	if err != nil {
		return SettlementBatchExportRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return SettlementBatchExportRecord{}, err
	}
	return item, nil
}

func buildSettlementBatchXLSX(rows [][]string) ([]byte, error) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	files := map[string]string{
		"[Content_Types].xml":        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
		"_rels/.rels":                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/workbook.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transfers" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
	}
	var sheet strings.Builder
	sheet.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	for rowIndex, row := range rows {
		sheet.WriteString(`<row r="`)
		sheet.WriteString(strconv.Itoa(rowIndex + 1))
		sheet.WriteString(`">`)
		for columnIndex, value := range row {
			cellRef := excelColumnName(columnIndex+1) + strconv.Itoa(rowIndex+1)
			if rowIndex > 0 && (columnIndex == 0 || columnIndex == 7) {
				sheet.WriteString(`<c r="` + cellRef + `"><v>` + value + `</v></c>`)
				continue
			}
			sheet.WriteString(`<c r="` + cellRef + `" t="inlineStr"><is><t xml:space="preserve">`)
			if err := xml.EscapeText(&sheet, []byte(value)); err != nil {
				return nil, err
			}
			sheet.WriteString(`</t></is></c>`)
		}
		sheet.WriteString(`</row>`)
	}
	sheet.WriteString(`</sheetData></worksheet>`)
	files["xl/worksheets/sheet1.xml"] = sheet.String()
	for name, value := range files {
		writer, err := archive.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := writer.Write([]byte(value)); err != nil {
			return nil, err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func excelColumnName(column int) string {
	var result string
	for column > 0 {
		column--
		result = string(rune('A'+column%26)) + result
		column /= 26
	}
	return result
}

func safeArtifactName(value string) string {
	var result strings.Builder
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '-' || character == '_' {
			result.WriteRune(character)
		}
	}
	if result.Len() == 0 {
		return "batch"
	}
	return result.String()
}
