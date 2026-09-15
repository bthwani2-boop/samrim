package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrCatalogImportInvalid = errors.New("catalog import facts are invalid")

type CatalogImportRunRecord struct {
	ID, ActingActorID, SourceSHA256, Mode, State string
	AcceptedCount, ConflictCount                 int
	CreatedAt                                    time.Time
}

type CatalogImportItemInput struct {
	RowNumber int
	StableKey string
	Input     CatalogProductInput
}

type CatalogImportItemRecord struct {
	RowNumber                 int
	StableKey, Classification string
	ProductID, VariantID      *string
	ErrorCode, ErrorMessage   *string
	Committed                 bool
	Input                     CatalogProductInput
}

type CatalogImportPreviewResult struct {
	Run      CatalogImportRunRecord
	Items    []CatalogImportItemRecord
	Replayed bool
}

type CatalogImportCommitResult struct {
	Run      CatalogImportRunRecord
	Items    []CatalogImportItemRecord
	Replayed bool
}

func HashCatalogImportPreviewRequest(runID, sourceSHA256 string, items []CatalogImportItemInput) string {
	raw, _ := json.Marshal(items)
	return hashFacts("catalog-import-preview", runID, sourceSHA256, string(raw))
}

func HashCatalogImportCommitRequest(runID string) string {
	return hashFacts("catalog-import-commit", runID)
}

func FindCatalogImportMatch(ctx context.Context, db *sql.DB, input CatalogProductInput) (string, string, bool, error) {
	where := []string{"p.vertical_id=$1", "p.scope=$2", "p.store_id IS NOT DISTINCT FROM NULLIF($3,'')"}
	args := []any{input.VerticalID, input.Scope, input.StoreID}
	if input.IdentifierValue != "" {
		where = append(where, "i.identifier_type=$4", "i.identifier_value=$5")
		args = append(args, input.IdentifierType, input.IdentifierValue)
	} else {
		where = append(where, "lower(p.canonical_name)=lower($4)", "v.title=$5", "v.measurement_kind=$6", "v.base_unit=$7")
		args = append(args, input.CanonicalName, input.VariantTitle, input.MeasurementKind, input.BaseUnit)
	}
	var productID, variantID string
	err := db.QueryRowContext(ctx, `SELECT p.id,v.id FROM dsh.catalog_products p JOIN dsh.catalog_product_variants v ON v.product_id=p.id LEFT JOIN dsh.catalog_variant_identifiers i ON i.variant_id=v.id WHERE `+strings.Join(where, " AND ")+` ORDER BY p.id,v.id LIMIT 1`, args...).Scan(&productID, &variantID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	product, err := ReadCatalogProduct(ctx, db, productID)
	if err != nil {
		return "", "", false, err
	}
	primaryImage := ""
	for _, media := range product.Media {
		if media.Role == "primary" {
			primaryImage = media.URI
			break
		}
	}
	sameCategories := len(product.CategoryIDs) == len(input.CategoryIDs)
	if sameCategories {
		seen := make(map[string]bool, len(product.CategoryIDs))
		for _, categoryID := range product.CategoryIDs {
			seen[categoryID] = true
		}
		for _, categoryID := range input.CategoryIDs {
			if !seen[categoryID] {
				sameCategories = false
				break
			}
		}
	}
	variant := productVariantByID(product, variantID)
	sameFacts := product.VerticalID == input.VerticalID && product.Scope == input.Scope && product.StoreID == input.StoreID && product.CanonicalName == input.CanonicalName && optionalProductFact(product.Brand) == optionalProductFact(input.Brand) && variant.Title == input.VariantTitle && variant.MeasurementKind == input.MeasurementKind && variant.BaseUnit == input.BaseUnit && sameCategories && primaryImage == input.ImageURI
	return productID, variantID, sameFacts, nil
}

func productVariantByID(product CatalogProductRecord, variantID string) CatalogVariantRecord {
	for _, variant := range product.Variants {
		if variant.ID == variantID {
			return variant
		}
	}
	return CatalogVariantRecord{}
}

func CreateCatalogImportPreview(ctx context.Context, db *sql.DB, run CatalogImportRunRecord, items []CatalogImportItemRecord, idempotencyKey, requestHash, correlationID string) (CatalogImportPreviewResult, error) {
	if strings.TrimSpace(run.ID) == "" || strings.TrimSpace(run.ActingActorID) == "" || len(run.SourceSHA256) != 64 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" || len(items) == 0 {
		return CatalogImportPreviewResult{}, ErrCatalogImportInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogImportPreviewResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-import:idempotency:"+idempotencyKey); err != nil {
		return CatalogImportPreviewResult{}, err
	}
	var storedHash, storedRun, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,run_id,operation FROM dsh.catalog_import_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedRun, &operation)
	if err == nil {
		if storedHash != requestHash || storedRun != run.ID || operation != "preview" {
			return CatalogImportPreviewResult{}, ErrCatalogIdempotencyConflict
		}
		readRun, readItems, readErr := readCatalogImportRunTx(ctx, tx, run.ID)
		if readErr != nil {
			return CatalogImportPreviewResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CatalogImportPreviewResult{}, err
		}
		return CatalogImportPreviewResult{Run: readRun, Items: readItems, Replayed: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogImportPreviewResult{}, err
	}
	var existingRun string
	if err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.catalog_import_runs WHERE source_sha256=$1 AND mode='preview'", run.SourceSHA256).Scan(&existingRun); err == nil {
		return CatalogImportPreviewResult{}, ErrCatalogIdempotencyConflict
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CatalogImportPreviewResult{}, err
	}
	run.Mode = "preview"
	run.State = "previewed"
	run.AcceptedCount = 0
	run.ConflictCount = 0
	for _, item := range items {
		if item.Classification == "READY" {
			run.AcceptedCount++
		} else {
			run.ConflictCount++
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_import_runs(id,acting_actor_id,source_sha256,mode,state,accepted_count,conflict_count) VALUES($1,$2,$3,$4,$5,$6,$7)", run.ID, run.ActingActorID, run.SourceSHA256, run.Mode, run.State, run.AcceptedCount, run.ConflictCount); err != nil {
		return CatalogImportPreviewResult{}, err
	}
	for _, item := range items {
		payload, marshalErr := json.Marshal(item.Input)
		if marshalErr != nil {
			return CatalogImportPreviewResult{}, marshalErr
		}
		if item.RowNumber < 1 || strings.TrimSpace(item.StableKey) == "" {
			return CatalogImportPreviewResult{}, ErrCatalogImportInvalid
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_import_run_items(run_id,row_number,stable_key,payload,classification,product_id,variant_id,error_code,error_message,committed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, run.ID, item.RowNumber, item.StableKey, payload, item.Classification, nullableImportString(item.ProductID), nullableImportString(item.VariantID), nullableImportString(item.ErrorCode), nullableImportString(item.ErrorMessage), item.Committed); err != nil {
			return CatalogImportPreviewResult{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_import_mutation_idempotency(idempotency_key,request_hash,run_id,operation,result_state) VALUES($1,$2,$3,'preview',$4)", idempotencyKey, requestHash, run.ID, run.State); err != nil {
		return CatalogImportPreviewResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_import_audit(event_type,idempotency_key,correlation_id,acting_actor_id,run_id,source_sha256,from_state,to_state,accepted_count,conflict_count,request_hash) VALUES('import_previewed',$1,$2,$3,$4,$5,NULL,$6,$7,$8,$9)`, idempotencyKey, correlationID, run.ActingActorID, run.ID, run.SourceSHA256, run.State, run.AcceptedCount, run.ConflictCount, requestHash); err != nil {
		return CatalogImportPreviewResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogImportPreviewResult{}, err
	}
	return ReadCatalogImportRun(ctx, db, run.ID)
}

func ReadCatalogImportRun(ctx context.Context, db *sql.DB, runID string) (CatalogImportPreviewResult, error) {
	run, items, err := readCatalogImportRunTx(ctx, db, strings.TrimSpace(runID))
	if err != nil {
		return CatalogImportPreviewResult{}, err
	}
	return CatalogImportPreviewResult{Run: run, Items: items}, nil
}

func readCatalogImportRunTx(ctx context.Context, source rowQueryer, runID string) (CatalogImportRunRecord, []CatalogImportItemRecord, error) {
	var run CatalogImportRunRecord
	err := source.QueryRowContext(ctx, "SELECT id,acting_actor_id,source_sha256,mode,state,accepted_count,conflict_count,created_at FROM dsh.catalog_import_runs WHERE id=$1", runID).Scan(&run.ID, &run.ActingActorID, &run.SourceSHA256, &run.Mode, &run.State, &run.AcceptedCount, &run.ConflictCount, &run.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogImportRunRecord{}, nil, ErrCatalogImportInvalid
	}
	if err != nil {
		return CatalogImportRunRecord{}, nil, err
	}
	rows, err := source.QueryContext(ctx, `SELECT row_number,stable_key,payload,classification,product_id,variant_id,error_code,error_message,committed FROM dsh.catalog_import_run_items WHERE run_id=$1 ORDER BY row_number`, runID)
	if err != nil {
		return CatalogImportRunRecord{}, nil, err
	}
	defer rows.Close()
	items := make([]CatalogImportItemRecord, 0)
	for rows.Next() {
		var item CatalogImportItemRecord
		var payload []byte
		var productID, variantID, errorCode, errorMessage sql.NullString
		if err = rows.Scan(&item.RowNumber, &item.StableKey, &payload, &item.Classification, &productID, &variantID, &errorCode, &errorMessage, &item.Committed); err != nil {
			return CatalogImportRunRecord{}, nil, err
		}
		if err = json.Unmarshal(payload, &item.Input); err != nil {
			return CatalogImportRunRecord{}, nil, fmt.Errorf("read import item %d: %w", item.RowNumber, err)
		}
		item.ProductID, item.VariantID = nullableString(productID), nullableString(variantID)
		item.ErrorCode, item.ErrorMessage = nullableString(errorCode), nullableString(errorMessage)
		items = append(items, item)
	}
	return run, items, rows.Err()
}

func MarkCatalogImportItem(ctx context.Context, db *sql.DB, runID string, rowNumber int, classification, productID, variantID, errorCode, errorMessage string, committed bool) error {
	if strings.TrimSpace(runID) == "" || rowNumber < 1 || strings.TrimSpace(classification) == "" {
		return ErrCatalogImportInvalid
	}
	result, err := db.ExecContext(ctx, `UPDATE dsh.catalog_import_run_items SET classification=$3,product_id=NULLIF($4,''),variant_id=NULLIF($5,''),error_code=NULLIF($6,''),error_message=NULLIF($7,''),committed=$8,updated_at=clock_timestamp() WHERE run_id=$1 AND row_number=$2`, runID, rowNumber, classification, productID, variantID, errorCode, errorMessage, committed)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrCatalogImportInvalid
	}
	return nil
}

func CompleteCatalogImport(ctx context.Context, db *sql.DB, runID, idempotencyKey, requestHash, actingActorID, correlationID string) (CatalogImportCommitResult, error) {
	if strings.TrimSpace(runID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CatalogImportCommitResult{}, ErrCatalogImportInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogImportCommitResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:catalog-import:commit:"+runID); err != nil {
		return CatalogImportCommitResult{}, err
	}
	var storedHash, storedRun, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,run_id,operation FROM dsh.catalog_import_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedRun, &operation)
	if err == nil {
		if storedHash != requestHash || storedRun != runID || operation != "commit" {
			return CatalogImportCommitResult{}, ErrCatalogIdempotencyConflict
		}
		var priorState string
		if err = tx.QueryRowContext(ctx, "SELECT result_state FROM dsh.catalog_import_mutation_idempotency WHERE idempotency_key=$1", idempotencyKey).Scan(&priorState); err != nil {
			return CatalogImportCommitResult{}, err
		}
		if priorState != "rejected" {
			run, items, readErr := readCatalogImportRunTx(ctx, tx, runID)
			if readErr != nil {
				return CatalogImportCommitResult{}, readErr
			}
			if err = tx.Commit(); err != nil {
				return CatalogImportCommitResult{}, err
			}
			return CatalogImportCommitResult{Run: run, Items: items, Replayed: true}, nil
		}
		// A rejected attempt is recoverable: retain its audit trail but allow the
		// same idempotency key to retry only the rows that still failed.
		if _, err = tx.ExecContext(ctx, "DELETE FROM dsh.catalog_import_mutation_idempotency WHERE idempotency_key=$1", idempotencyKey); err != nil {
			return CatalogImportCommitResult{}, err
		}
		// Continue through the normal first-attempt path after removing the
		// recoverable rejected marker.
		err = sql.ErrNoRows
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CatalogImportCommitResult{}, err
	}
	var currentState, sourceSHA string
	var mode string
	var accepted, conflicts int
	if err = tx.QueryRowContext(ctx, "SELECT mode,state,source_sha256,accepted_count,conflict_count FROM dsh.catalog_import_runs WHERE id=$1 FOR UPDATE", runID).Scan(&mode, &currentState, &sourceSHA, &accepted, &conflicts); errors.Is(err, sql.ErrNoRows) {
		return CatalogImportCommitResult{}, ErrCatalogImportInvalid
	} else if err != nil {
		return CatalogImportCommitResult{}, err
	}
	if !((mode == "preview" && currentState == "previewed") || (mode == "commit" && currentState == "rejected")) {
		return CatalogImportCommitResult{}, ErrCatalogImportInvalid
	}
	var failed int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.catalog_import_run_items WHERE run_id=$1 AND classification='FAILED'", runID).Scan(&failed); err != nil {
		return CatalogImportCommitResult{}, err
	}
	state := "committed"
	event := "import_committed"
	if failed > 0 {
		state = "rejected"
		event = "import_rejected"
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.catalog_import_runs SET mode='commit',state=$2 WHERE id=$1", runID, state); err != nil {
		return CatalogImportCommitResult{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.catalog_import_mutation_idempotency(idempotency_key,request_hash,run_id,operation,result_state) VALUES($1,$2,$3,'commit',$4)", idempotencyKey, requestHash, runID, state); err != nil {
		return CatalogImportCommitResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.catalog_import_audit(event_type,idempotency_key,correlation_id,acting_actor_id,run_id,source_sha256,from_state,to_state,accepted_count,conflict_count,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (event_type,idempotency_key) DO UPDATE SET correlation_id=EXCLUDED.correlation_id,acting_actor_id=EXCLUDED.acting_actor_id,from_state=EXCLUDED.from_state,to_state=EXCLUDED.to_state,accepted_count=EXCLUDED.accepted_count,conflict_count=EXCLUDED.conflict_count,request_hash=EXCLUDED.request_hash,created_at=clock_timestamp()`, event, idempotencyKey, correlationID, actingActorID, runID, sourceSHA, currentState, state, accepted, conflicts, requestHash); err != nil {
		return CatalogImportCommitResult{}, err
	}
	run, items, err := readCatalogImportRunTx(ctx, tx, runID)
	if err != nil {
		return CatalogImportCommitResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CatalogImportCommitResult{}, err
	}
	return CatalogImportCommitResult{Run: run, Items: items}, nil
}

func nullableImportString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
