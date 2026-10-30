package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}

func readSettlementStatement(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, statementID string) (SettlementStatementRecord, error) {
	var item SettlementStatementRecord
	var batchID sql.NullString
	err := source.QueryRowContext(ctx, `SELECT s.id,s.batch_id,s.provider_key,s.currency,s.period_start,s.period_end,s.evidence_document_id,d.original_filename,d.content_sha256,s.uploaded_by,s.created_at FROM wlt.settlement_statements s JOIN wlt.finance_evidence_documents d ON d.id=s.evidence_document_id WHERE s.id=$1`, statementID).Scan(&item.ID, &batchID, &item.ProviderKey, &item.Currency, &item.PeriodStart, &item.PeriodEnd, &item.EvidenceDocumentID, &item.Filename, &item.ArtifactSHA256, &item.UploadedBy, &item.CreatedAt)
	if batchID.Valid {
		item.BatchID = &batchID.String
	}
	return item, err
}

func readSettlementStatementRow(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, rowID string) (SettlementStatementRowRecord, error) {
	var item SettlementStatementRowRecord
	var matchedTransferID sql.NullString
	err := source.QueryRowContext(ctx, `SELECT id,statement_id,row_sequence,external_transfer_reference,amount_minor,currency,transaction_at,recorded_by,matched_transfer_id FROM wlt.settlement_statement_rows WHERE id=$1`, rowID).Scan(&item.ID, &item.StatementID, &item.RowSequence, &item.ExternalReference, &item.AmountMinor, &item.Currency, &item.TransactionAt, &item.RecordedBy, &matchedTransferID)
	if matchedTransferID.Valid {
		item.MatchedTransferID = &matchedTransferID.String
	}
	return item, err
}

func readPayoutForUpdate(ctx context.Context, tx *sql.Tx, payoutID string) (PayoutRequestRecord, error) {
	var id string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM wlt.payout_requests WHERE id=$1 FOR UPDATE", payoutID).Scan(&id); errors.Is(err, sql.ErrNoRows) {
		return PayoutRequestRecord{}, ErrPayoutNotFound
	} else if err != nil {
		return PayoutRequestRecord{}, err
	}
	return readPayoutRequest(ctx, tx, payoutID)
}

func validMutationContext(idempotencyKey, correlationID string) bool {
	return len(idempotencyKey) >= 8 && len(idempotencyKey) <= 128 && len(correlationID) >= 8 && len(correlationID) <= 128
}

func validPayoutStatus(status string) bool {
	switch status {
	case "HELD", "CANCELLED", "PREPARED", "APPROVED", "FROZEN", "EXECUTED", "COMPLETED", "EXCEPTION":
		return true
	default:
		return false
	}
}

func existingPayoutAudit(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, requestHash string) (bool, string, string, error) {
	var existingType, existingHash string
	var payoutID, batchID sql.NullString
	err := tx.QueryRowContext(ctx, "SELECT event_type,request_hash,payout_id,batch_id FROM wlt.payout_audit_events WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&existingType, &existingHash, &payoutID, &batchID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, "", "", nil
	}
	if err != nil {
		return false, "", "", err
	}
	if existingType != eventType || existingHash != requestHash {
		return false, "", "", ErrIdempotencyConflict
	}
	return true, payoutID.String, batchID.String, nil
}

func insertPayoutAudit(ctx context.Context, tx *sql.Tx, eventType, payoutID, batchID, actorID, reason, evidence, idempotencyKey, requestHash, correlationID string) error {
	id, err := newID("payout_audit")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.payout_audit_events(id,event_type,payout_id,batch_id,actor_id,reason,evidence_reference,idempotency_key,request_hash,correlation_id) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,$10)`, id, eventType, payoutID, batchID, actorID, reason, evidence, idempotencyKey, requestHash, correlationID)
	return err
}

func scanPayoutSnapshot(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, payoutID string, item *PayoutSnapshotRecord) error {
	var approvedBy sql.NullString
	var approvedAt sql.NullTime
	var identityActorVersion, identityRoleVersion sql.NullInt64
	var roleEnabled, securityEnabled sql.NullBool
	var officialNameStatus sql.NullString
	err := source.QueryRowContext(ctx, `SELECT payout_id,actor_type,actor_id,beneficiary_name,beneficiary_identity_version,provider_key,masked_destination,destination_id,destination_version,amount_mode,resolved_amount_minor,currency,policy_version,snapshot_hash,prepared_by,prepared_at,approved_by,approved_at,identity_actor_version_snapshot,identity_role_version_snapshot,role_enabled_snapshot,security_enabled_snapshot,official_name_status_snapshot FROM wlt.approved_payout_snapshots WHERE payout_id=$1`, payoutID).Scan(&item.PayoutID, &item.ActorType, &item.ActorID, &item.BeneficiaryName, &item.BeneficiaryIdentityVersion, &item.ProviderKey, &item.MaskedDestination, &item.DestinationID, &item.DestinationVersion, &item.AmountMode, &item.ResolvedAmountMinor, &item.Currency, &item.PolicyVersion, &item.SnapshotHash, &item.PreparedBy, &item.PreparedAt, &approvedBy, &approvedAt, &identityActorVersion, &identityRoleVersion, &roleEnabled, &securityEnabled, &officialNameStatus)
	if identityActorVersion.Valid && identityRoleVersion.Valid && roleEnabled.Valid && securityEnabled.Valid && officialNameStatus.Valid {
		item.IdentityActorVersion, item.IdentityRoleVersion = int(identityActorVersion.Int64), int(identityRoleVersion.Int64)
		item.RoleEnabled, item.SecurityEnabled, item.OfficialNameStatus = roleEnabled.Bool, securityEnabled.Bool, officialNameStatus.String
		item.IdentitySnapshotKnown = true
	}
	if approvedBy.Valid {
		item.ApprovedBy = &approvedBy.String
	}
	if approvedAt.Valid {
		item.ApprovedAt = &approvedAt.Time
	}
	return err
}

func (snapshot PayoutSnapshotRecord) matchesIdentityFacts(facts IdentityFacts) bool {
	facts = facts.normalized()
	if !snapshot.IdentitySnapshotKnown {
		return facts.validFor(snapshot.ActorType, snapshot.ActorID) && snapshot.BeneficiaryName == facts.OfficialName &&
			snapshot.BeneficiaryIdentityVersion == facts.OfficialNameVersion
	}
	return snapshot.IdentitySnapshotKnown && snapshot.ActorType == facts.ActorType && snapshot.ActorID == facts.ActorID &&
		snapshot.BeneficiaryName == facts.OfficialName && snapshot.BeneficiaryIdentityVersion == facts.OfficialNameVersion &&
		snapshot.IdentityActorVersion == facts.ActorVersion && snapshot.IdentityRoleVersion == facts.RoleVersion &&
		snapshot.RoleEnabled == facts.RoleEnabled && snapshot.SecurityEnabled == facts.SecurityEnabled &&
		snapshot.OfficialNameStatus == facts.OfficialNameStatus
}

func (snapshot PayoutSnapshotRecord) matchesDestination(destination OfficialWalletDestinationRecord) bool {
	return snapshot.ActorType == destination.ActorType && snapshot.ActorID == destination.ActorID &&
		snapshot.BeneficiaryName == destination.BeneficiaryName && snapshot.BeneficiaryIdentityVersion == destination.BeneficiaryIdentityVersion &&
		snapshot.ProviderKey == destination.ProviderKey && snapshot.MaskedDestination == destination.WalletIdentifierMasked &&
		snapshot.DestinationID == destination.ID && snapshot.DestinationVersion == destination.Version &&
		destination.VerificationStatus == "VERIFIED" && destination.Status == "ACTIVE_FOR_PAYOUT"
}

func scanSettlementBatch(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, batchID string, forUpdate bool, item *SettlementBatchRecord) error {
	query := `SELECT id,provider_key,currency,status,row_count,total_amount_minor,created_by,created_at,approved_by,approved_at,frozen_by,frozen_at,COALESCE(batch_hash,'') FROM wlt.settlement_batches WHERE id=$1`
	if forUpdate {
		query += " FOR UPDATE"
	}
	var approvedBy, frozenBy sql.NullString
	var approvedAt, frozenAt sql.NullTime
	err := source.QueryRowContext(ctx, query, batchID).Scan(&item.ID, &item.ProviderKey, &item.Currency, &item.Status, &item.RowCount, &item.TotalAmountMinor, &item.CreatedBy, &item.CreatedAt, &approvedBy, &approvedAt, &frozenBy, &frozenAt, &item.BatchHash)
	if approvedBy.Valid {
		item.ApprovedBy = &approvedBy.String
	}
	if approvedAt.Valid {
		item.ApprovedAt = &approvedAt.Time
	}
	if frozenBy.Valid {
		item.FrozenBy = &frozenBy.String
	}
	if frozenAt.Valid {
		item.FrozenAt = &frozenAt.Time
	}
	return err
}

func readSettlementBatch(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, batchID string) (SettlementBatchRecord, error) {
	var item SettlementBatchRecord
	err := scanSettlementBatch(ctx, source, batchID, false, &item)
	if errors.Is(err, sql.ErrNoRows) {
		return SettlementBatchRecord{}, ErrSettlementBatchNotFound
	}
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	rows, err := source.QueryContext(ctx, `SELECT i.payout_id,s.actor_type,s.actor_id,i.amount_minor,i.currency,p.status FROM wlt.settlement_batch_items i JOIN wlt.approved_payout_snapshots s ON s.payout_id=i.payout_id JOIN wlt.payout_requests p ON p.id=i.payout_id WHERE i.batch_id=$1 ORDER BY i.row_sequence`, batchID)
	if err != nil {
		return SettlementBatchRecord{}, err
	}
	type itemRef struct {
		payoutID string
		item     SettlementBatchItemRecord
	}
	refs := make([]itemRef, 0, item.RowCount)
	for rows.Next() {
		var ref itemRef
		if err := rows.Scan(&ref.payoutID, &ref.item.ActorType, &ref.item.ActorID, &ref.item.AmountMinor, &ref.item.Currency, &ref.item.PayoutStatus); err != nil {
			_ = rows.Close()
			return SettlementBatchRecord{}, err
		}
		ref.item.PayoutID = ref.payoutID
		refs = append(refs, ref)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return SettlementBatchRecord{}, err
	}
	if err := rows.Close(); err != nil {
		return SettlementBatchRecord{}, err
	}
	item.Items = make([]SettlementBatchItemRecord, 0, len(refs))
	for _, ref := range refs {
		var transferID string
		lookupErr := source.QueryRowContext(ctx, `SELECT id FROM wlt.manual_transfer_executions WHERE payout_id=$1`, ref.payoutID).Scan(&transferID)
		if lookupErr == nil {
			var transfer ManualTransferExecutionRecord
			if err := scanManualTransfer(ctx, source, transferID, false, &transfer); err != nil {
				return SettlementBatchRecord{}, err
			}
			ref.item.Transfer = &transfer
		} else if !errors.Is(lookupErr, sql.ErrNoRows) {
			return SettlementBatchRecord{}, lookupErr
		}
		item.Items = append(item.Items, ref.item)
	}
	return item, nil
}

func ReadSettlementBatch(ctx context.Context, db *sql.DB, batchID string) (SettlementBatchRecord, error) {
	batchID = strings.TrimSpace(batchID)
	if db == nil || boundedText(batchID, 1, 128) == "" {
		return SettlementBatchRecord{}, ErrSettlementBatchInput
	}
	return readSettlementBatch(ctx, db, batchID)
}

func ListSettlementBatches(ctx context.Context, db *sql.DB, status string, beforeCreatedAt *time.Time, beforeID string, limit int) ([]SettlementBatchRecord, bool, error) {
	status, beforeID = strings.ToUpper(strings.TrimSpace(status)), strings.TrimSpace(beforeID)
	if db == nil || (status != "" && !validSettlementBatchStatus(status)) || (beforeCreatedAt == nil) != (beforeID == "") || (beforeCreatedAt != nil && boundedText(beforeID, 1, 128) == "") || limit < 1 || limit > 100 {
		return nil, false, ErrSettlementBatchInput
	}
	rows, err := db.QueryContext(ctx, `SELECT id FROM wlt.settlement_batches WHERE ($1='' OR status=$1) AND ($2::timestamptz IS NULL OR (created_at,id) < ($2,$3)) ORDER BY created_at DESC,id DESC LIMIT $4`, status, beforeCreatedAt, beforeID, limit+1)
	if err != nil {
		return nil, false, err
	}
	ids := make([]string, 0, limit+1)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, false, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, false, err
	}
	if err := rows.Close(); err != nil {
		return nil, false, err
	}
	hasMore := len(ids) > limit
	if hasMore {
		ids = ids[:limit]
	}
	result := make([]SettlementBatchRecord, 0, len(ids))
	for _, id := range ids {
		item, err := ReadSettlementBatch(ctx, db, id)
		if err != nil {
			return nil, false, err
		}
		result = append(result, item)
	}
	return result, hasMore, nil
}

func scanManualTransfer(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, transferID string, forUpdate bool, item *ManualTransferExecutionRecord) error {
	query := `SELECT e.id,e.batch_id,e.payout_id,e.approved_snapshot_hash,e.executed_by,e.executed_at,e.provider_key,e.external_transfer_reference,e.amount_minor,e.currency,e.destination_id,e.destination_version,COALESCE(d.id,''),e.execution_status,e.verified_by,e.verified_at,e.statement_row_id,e.reconciled_by,e.reconciled_at FROM wlt.manual_transfer_executions e LEFT JOIN wlt.finance_evidence_documents d ON d.id=e.receipt_document_id WHERE e.id=$1`
	if forUpdate {
		query += " FOR UPDATE OF e"
	}
	var verifiedBy, statementRowID, reconciledBy sql.NullString
	var verifiedAt, reconciledAt sql.NullTime
	err := source.QueryRowContext(ctx, query, transferID).Scan(&item.ID, &item.BatchID, &item.PayoutID, &item.ApprovedSnapshotHash, &item.ExecutedBy, &item.ExecutedAt, &item.ProviderKey, &item.ExternalReference, &item.AmountMinor, &item.Currency, &item.DestinationID, &item.DestinationVersion, &item.ReceiptDocumentID, &item.ExecutionStatus, &verifiedBy, &verifiedAt, &statementRowID, &reconciledBy, &reconciledAt)
	if verifiedBy.Valid {
		item.VerifiedBy = &verifiedBy.String
	}
	if verifiedAt.Valid {
		item.VerifiedAt = &verifiedAt.Time
	}
	if statementRowID.Valid {
		item.StatementRowID = &statementRowID.String
	}
	if reconciledBy.Valid {
		item.ReconciledBy = &reconciledBy.String
	}
	if reconciledAt.Valid {
		item.ReconciledAt = &reconciledAt.Time
	}
	return err
}

func readManualTransfer(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, payoutID string) (ManualTransferExecutionRecord, error) {
	var item ManualTransferExecutionRecord
	err := source.QueryRowContext(ctx, "SELECT id FROM wlt.manual_transfer_executions WHERE payout_id=$1", payoutID).Scan(&item.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return ManualTransferExecutionRecord{}, ErrTransferNotFound
	}
	if err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	if err := scanManualTransfer(ctx, source, item.ID, false, &item); err != nil {
		return ManualTransferExecutionRecord{}, err
	}
	return item, nil
}

func payoutActor(ctx context.Context, tx *sql.Tx, payoutID string) (string, string, error) {
	var actorType, actorID string
	err := tx.QueryRowContext(ctx, "SELECT actor_type,actor_id FROM wlt.payout_requests WHERE id=$1", payoutID).Scan(&actorType, &actorID)
	return actorType, actorID, err
}

func walletAccountCodeForTransfer(ctx context.Context, tx *sql.Tx, payoutID string) string {
	actorType, _, err := payoutActor(ctx, tx, payoutID)
	if err != nil {
		return ""
	}
	return walletAccountCode(actorType)
}

func mustNewID(prefix string) string {
	id, err := newID(prefix)
	if err != nil {
		return prefix + "-invalid"
	}
	return id
}

func validSettlementBatchStatus(status string) bool {
	switch status {
	case "DRAFT", "PREPARED", "APPROVED", "FROZEN", "EXECUTION_IN_PROGRESS", "AWAITING_VERIFICATION", "AWAITING_RECONCILIATION", "COMPLETED", "CANCELLED", "EXCEPTION":
		return true
	default:
		return false
	}
}
