package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrCustomerWithdrawalNotFound = errors.New("customer manual withdrawal intake was not found")
	ErrCustomerWithdrawalState    = errors.New("customer manual withdrawal intake state does not allow this operation")
	ErrCustomerWithdrawalFunds    = errors.New("customer internal balance has no eligible withdrawal funds")
)

type CustomerWithdrawalIntakeInput struct {
	CustomerActorID            string
	ProviderKey                string
	WalletIdentifier           string
	BeneficiaryName            string
	BeneficiaryIdentityVersion int
	RequestReason              string
	RequestEvidenceDocumentID  string
	RequestedBy                string
	IdempotencyKey             string
	CorrelationID              string
}

type CustomerWithdrawalIntakeRecord struct {
	ID                         string     `json:"id"`
	CustomerActorID            string     `json:"customerActorId"`
	ProviderKey                string     `json:"providerKey"`
	WalletIdentifierMasked     string     `json:"walletIdentifierMasked"`
	BeneficiaryName            string     `json:"beneficiaryName"`
	BeneficiaryIdentityVersion int        `json:"beneficiaryIdentityVersion"`
	RequestReason              string     `json:"requestReason"`
	RequestEvidenceDocumentID  string     `json:"requestEvidenceDocumentId"`
	Status                     string     `json:"status"`
	DestinationID              *string    `json:"destinationId,omitempty"`
	PayoutID                   *string    `json:"payoutId,omitempty"`
	RequestedBy                string     `json:"requestedBy"`
	RequestedAt                time.Time  `json:"requestedAt"`
	FinanceActorID             *string    `json:"financeActorId,omitempty"`
	ResolvedAt                 *time.Time `json:"resolvedAt,omitempty"`
	ResolutionReason           *string    `json:"resolutionReason,omitempty"`
}

type CustomerWithdrawalAcceptInput struct {
	IntakeID       string
	ActorID        string
	Reason         string
	IdempotencyKey string
	CorrelationID  string
}

func CreateCustomerWithdrawalIntake(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input CustomerWithdrawalIntakeInput) (CustomerWithdrawalIntakeRecord, bool, error) {
	input.CustomerActorID = strings.TrimSpace(input.CustomerActorID)
	input.ProviderKey = strings.TrimSpace(input.ProviderKey)
	input.WalletIdentifier = strings.TrimSpace(input.WalletIdentifier)
	input.BeneficiaryName = strings.TrimSpace(input.BeneficiaryName)
	input.RequestReason = strings.TrimSpace(input.RequestReason)
	input.RequestEvidenceDocumentID = strings.TrimSpace(input.RequestEvidenceDocumentID)
	input.RequestedBy = strings.TrimSpace(input.RequestedBy)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || cipher == nil || boundedText(input.CustomerActorID, 1, 128) == "" || boundedText(input.ProviderKey, 1, 64) == "" || !officialWalletPhoneE164Pattern.MatchString(input.WalletIdentifier) || boundedText(input.BeneficiaryName, 1, 320) == "" || input.BeneficiaryIdentityVersion < 1 || boundedText(input.RequestReason, 1, 512) == "" || boundedText(input.RequestEvidenceDocumentID, 1, 128) == "" || boundedText(input.RequestedBy, 1, 128) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return CustomerWithdrawalIntakeRecord{}, false, ErrPayoutInvalidInput
	}
	var evidencePurpose string
	if err := db.QueryRowContext(ctx, "SELECT purpose FROM wlt.finance_evidence_documents WHERE id=$1", input.RequestEvidenceDocumentID).Scan(&evidencePurpose); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CustomerWithdrawalIntakeRecord{}, false, ErrPayoutInvalidInput
		}
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	if evidencePurpose != "CUSTOMER_WITHDRAWAL_REQUEST" {
		return CustomerWithdrawalIntakeRecord{}, false, ErrPayoutInvalidInput
	}
	ciphertext, err := cipher.encrypt(input.WalletIdentifier)
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	requestHash := hashFacts("customer-manual-withdrawal-intake", input.CustomerActorID, input.ProviderKey, input.WalletIdentifier, input.BeneficiaryName, formatInt(input.BeneficiaryIdentityVersion), input.RequestReason, input.RequestEvidenceDocumentID, input.RequestedBy)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.customer_manual_withdrawal_intakes WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return CustomerWithdrawalIntakeRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readCustomerWithdrawalIntake(ctx, tx, existingID)
		if readErr != nil {
			return CustomerWithdrawalIntakeRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CustomerWithdrawalIntakeRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	id, err := newID("customer_withdrawal")
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.customer_manual_withdrawal_intakes(id,customer_actor_id,provider_key,wallet_identifier_ciphertext,wallet_identifier_masked,beneficiary_name,beneficiary_identity_version,request_reason,request_evidence_document_id,requested_by,idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, id, input.CustomerActorID, input.ProviderKey, ciphertext, maskWalletIdentifier(input.WalletIdentifier), input.BeneficiaryName, input.BeneficiaryIdentityVersion, input.RequestReason, input.RequestEvidenceDocumentID, input.RequestedBy, input.IdempotencyKey, requestHash, input.CorrelationID)
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	if err := insertCustomerWithdrawalEvent(ctx, tx, id, "OPS_REQUESTED", input.RequestedBy, input.RequestReason, input.RequestEvidenceDocumentID, "", input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	item, err := readCustomerWithdrawalIntake(ctx, tx, id)
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CustomerWithdrawalIntakeRecord{}, false, err
	}
	return item, false, nil
}

func ListCustomerWithdrawalIntakes(ctx context.Context, db *sql.DB, status string, limit int) ([]CustomerWithdrawalIntakeRecord, error) {
	if db == nil {
		return nil, ErrPayoutInvalidInput
	}
	status = strings.ToUpper(strings.TrimSpace(status))
	if status != "" && status != "REQUESTED" && status != "DESTINATION_PENDING" && status != "PAYOUT_HELD" && status != "REJECTED" && status != "COMPLETED" {
		return nil, ErrPayoutInvalidInput
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	query := "SELECT id FROM wlt.customer_manual_withdrawal_intakes"
	args := []any{}
	if status != "" {
		query += " WHERE status=$1"
		args = append(args, status)
	}
	query += " ORDER BY requested_at DESC,id DESC LIMIT $" + formatInt(len(args)+1)
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]CustomerWithdrawalIntakeRecord, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		item, err := readCustomerWithdrawalIntake(ctx, db, id)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func ReadCustomerWithdrawalIntake(ctx context.Context, db *sql.DB, intakeID string) (CustomerWithdrawalIntakeRecord, error) {
	if db == nil || boundedText(strings.TrimSpace(intakeID), 1, 128) == "" {
		return CustomerWithdrawalIntakeRecord{}, ErrCustomerWithdrawalNotFound
	}
	return readCustomerWithdrawalIntake(ctx, db, strings.TrimSpace(intakeID))
}

func PrepareCustomerWithdrawalDestination(ctx context.Context, db *sql.DB, cipher *DestinationCipher, intakeID, actorID, reason, idempotencyKey, correlationID string) (OfficialWalletDestinationRecord, error) {
	intakeID, actorID, reason = strings.TrimSpace(intakeID), strings.TrimSpace(actorID), strings.TrimSpace(reason)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || cipher == nil || boundedText(intakeID, 1, 128) == "" || boundedText(actorID, 1, 128) == "" || boundedText(reason, 1, 512) == "" || !validMutationContext(idempotencyKey, correlationID) {
		return OfficialWalletDestinationRecord{}, ErrDestinationInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var actor, provider, walletCipher, masked, name, requestReason, requestEvidence, status string
	var nameVersion int
	var existingDestination sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT customer_actor_id,provider_key,wallet_identifier_ciphertext,wallet_identifier_masked,beneficiary_name,beneficiary_identity_version,request_reason,request_evidence_document_id,status,destination_id FROM wlt.customer_manual_withdrawal_intakes WHERE id=$1 FOR UPDATE`, intakeID).Scan(&actor, &provider, &walletCipher, &masked, &name, &nameVersion, &requestReason, &requestEvidence, &status, &existingDestination)
	if errors.Is(err, sql.ErrNoRows) {
		return OfficialWalletDestinationRecord{}, ErrCustomerWithdrawalNotFound
	}
	if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	wallet, err := cipher.decrypt(walletCipher)
	if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	requestHash := hashFacts("customer-withdrawal-destination", intakeID, actor, provider, wallet, name, formatInt(nameVersion), reason, requestEvidence, actorID)
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.official_wallet_destinations WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return OfficialWalletDestinationRecord{}, ErrIdempotencyConflict
		}
		item, readErr := readOfficialWalletDestination(ctx, tx, existingID)
		if readErr != nil {
			return OfficialWalletDestinationRecord{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return OfficialWalletDestinationRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OfficialWalletDestinationRecord{}, err
	}
	if status != "REQUESTED" {
		return OfficialWalletDestinationRecord{}, ErrCustomerWithdrawalState
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:destination:customer:"+actor); err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	var version int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM wlt.official_wallet_destinations WHERE actor_type='customer' AND actor_id=$1", actor).Scan(&version); err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	destinationID, err := newID("destination")
	if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.official_wallet_destinations(id,actor_type,actor_id,provider_key,wallet_identifier_ciphertext,wallet_identifier_masked,beneficiary_name,beneficiary_identity_version,version,change_reason,submitted_by,verification_evidence_reference,change_evidence_reference,idempotency_key,request_hash)
		VALUES($1,'customer',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, destinationID, actor, provider, walletCipher, masked, name, nameVersion, version, reason, actorID, requestEvidence, requestEvidence, idempotencyKey, requestHash); err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.customer_manual_withdrawal_intakes SET status='DESTINATION_PENDING',destination_id=$2,finance_actor_id=$3,resolved_at=clock_timestamp(),resolution_reason=$4 WHERE id=$1`, intakeID, destinationID, actorID, reason); err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	if err := insertCustomerWithdrawalEvent(ctx, tx, intakeID, "DESTINATION_PREPARED", actorID, reason, requestEvidence, "", idempotencyKey, requestHash, correlationID); err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	item, err := readOfficialWalletDestination(ctx, tx, destinationID)
	if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	return item, nil
}

func AcceptCustomerWithdrawal(ctx context.Context, db *sql.DB, input CustomerWithdrawalAcceptInput) (PayoutRequestRecord, error) {
	input.IntakeID, input.ActorID, input.Reason = strings.TrimSpace(input.IntakeID), strings.TrimSpace(input.ActorID), strings.TrimSpace(input.Reason)
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	if db == nil || boundedText(input.IntakeID, 1, 128) == "" || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.Reason, 1, 512) == "" || !validMutationContext(input.IdempotencyKey, input.CorrelationID) {
		return PayoutRequestRecord{}, ErrPayoutInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var customerID, destinationID, status string
	err = tx.QueryRowContext(ctx, `SELECT customer_actor_id,destination_id,status FROM wlt.customer_manual_withdrawal_intakes WHERE id=$1 FOR UPDATE`, input.IntakeID).Scan(&customerID, &destinationID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return PayoutRequestRecord{}, ErrCustomerWithdrawalNotFound
	}
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	var priorActor, priorReason, priorPayoutID string
	priorErr := tx.QueryRowContext(ctx, `SELECT acting_actor_id,reason,payout_id FROM wlt.customer_manual_withdrawal_events WHERE intake_id=$1 AND idempotency_key=$2`, input.IntakeID, input.IdempotencyKey).Scan(&priorActor, &priorReason, &priorPayoutID)
	if priorErr == nil {
		if priorActor != input.ActorID || priorReason != input.Reason || priorPayoutID == "" {
			return PayoutRequestRecord{}, ErrIdempotencyConflict
		}
		item, readErr := readPayoutRequest(ctx, tx, priorPayoutID)
		if readErr != nil {
			return PayoutRequestRecord{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return PayoutRequestRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(priorErr, sql.ErrNoRows) {
		return PayoutRequestRecord{}, priorErr
	}
	if status == "PAYOUT_HELD" {
		return PayoutRequestRecord{}, ErrCustomerWithdrawalState
	}
	if status != "DESTINATION_PENDING" {
		return PayoutRequestRecord{}, ErrCustomerWithdrawalState
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:payout:customer:"+customerID); err != nil {
		return PayoutRequestRecord{}, err
	}
	var destinationVersion, identityVersion int
	var providerKey, verificationStatus, destinationStatus string
	if err := tx.QueryRowContext(ctx, `SELECT version,beneficiary_identity_version,provider_key,verification_status,status FROM wlt.official_wallet_destinations WHERE id=$1 AND actor_type='customer' AND actor_id=$2 FOR SHARE`, destinationID, customerID).Scan(&destinationVersion, &identityVersion, &providerKey, &verificationStatus, &destinationStatus); err != nil {
		return PayoutRequestRecord{}, err
	}
	if verificationStatus != "VERIFIED" || destinationStatus != "ACTIVE_FOR_PAYOUT" || identityVersion < 1 {
		return PayoutRequestRecord{}, ErrPayoutDestination
	}
	var available, held int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0) FROM wlt.ledger_entries WHERE account_code='CUSTOMER_WALLET' AND actor_type='customer' AND actor_id=$1`, customerID).Scan(&available); err != nil {
		return PayoutRequestRecord{}, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(amount_minor),0) FROM wlt.payout_holds WHERE actor_type='customer' AND actor_id=$1 AND status='ACTIVE'", customerID).Scan(&held); err != nil {
		return PayoutRequestRecord{}, err
	}
	available -= held
	if available <= 0 {
		return PayoutRequestRecord{}, ErrCustomerWithdrawalFunds
	}
	payoutID, err := newID("payout")
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	holdID, err := newID("hold")
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	requestHash := hashFacts("ops-customer-manual-withdrawal", input.IntakeID, customerID, formatInt64(available), destinationID, formatInt(destinationVersion), input.ActorID, input.Reason)
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payout_requests(id,actor_type,actor_id,amount_mode,requested_amount_minor,resolved_amount_minor,destination_id,destination_version,status,policy_version,idempotency_key,request_hash)
		VALUES($1,'customer',$2,'FULL_AVAILABLE',NULL,$3,$4,$5,'HELD',$6,$7,$8)`, payoutID, customerID, available, destinationID, destinationVersion, "customer-manual-withdrawal-v1;identity-version="+formatInt(identityVersion), input.IdempotencyKey, requestHash); err != nil {
		return PayoutRequestRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.payout_holds(id,payout_id,actor_type,actor_id,amount_minor) VALUES($1,$2,'customer',$3,$4)`, holdID, payoutID, customerID, available); err != nil {
		return PayoutRequestRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.customer_manual_withdrawal_intakes SET status='PAYOUT_HELD',payout_id=$2,finance_actor_id=$3,resolved_at=clock_timestamp(),resolution_reason=$4 WHERE id=$1`, input.IntakeID, payoutID, input.ActorID, input.Reason); err != nil {
		return PayoutRequestRecord{}, err
	}
	if err := insertCustomerWithdrawalEvent(ctx, tx, input.IntakeID, "FINANCE_ACCEPTED", input.ActorID, input.Reason, "", payoutID, input.IdempotencyKey, requestHash, input.CorrelationID); err != nil {
		return PayoutRequestRecord{}, err
	}
	item, err := readPayoutRequest(ctx, tx, payoutID)
	if err != nil {
		return PayoutRequestRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return PayoutRequestRecord{}, err
	}
	return item, nil
}

func RejectCustomerWithdrawal(ctx context.Context, db *sql.DB, intakeID, actorID, reason, idempotencyKey, correlationID string) (CustomerWithdrawalIntakeRecord, error) {
	intakeID, actorID, reason = strings.TrimSpace(intakeID), strings.TrimSpace(actorID), strings.TrimSpace(reason)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || boundedText(intakeID, 1, 128) == "" || boundedText(actorID, 1, 128) == "" || boundedText(reason, 1, 512) == "" || !validMutationContext(idempotencyKey, correlationID) {
		return CustomerWithdrawalIntakeRecord{}, ErrPayoutInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var status string
	err = tx.QueryRowContext(ctx, "SELECT status FROM wlt.customer_manual_withdrawal_intakes WHERE id=$1 FOR UPDATE", intakeID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return CustomerWithdrawalIntakeRecord{}, ErrCustomerWithdrawalNotFound
	}
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, err
	}
	var priorType, priorActor, priorReason string
	priorErr := tx.QueryRowContext(ctx, `SELECT event_type,acting_actor_id,reason FROM wlt.customer_manual_withdrawal_events WHERE intake_id=$1 AND idempotency_key=$2`, intakeID, idempotencyKey).Scan(&priorType, &priorActor, &priorReason)
	if priorErr == nil {
		if priorType != "FINANCE_REJECTED" || priorActor != actorID || priorReason != reason {
			return CustomerWithdrawalIntakeRecord{}, ErrIdempotencyConflict
		}
		item, readErr := readCustomerWithdrawalIntake(ctx, tx, intakeID)
		if readErr != nil {
			return CustomerWithdrawalIntakeRecord{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CustomerWithdrawalIntakeRecord{}, err
		}
		return item, nil
	}
	if !errors.Is(priorErr, sql.ErrNoRows) {
		return CustomerWithdrawalIntakeRecord{}, priorErr
	}
	if status != "REQUESTED" && status != "DESTINATION_PENDING" {
		return CustomerWithdrawalIntakeRecord{}, ErrCustomerWithdrawalState
	}
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.official_wallet_destinations SET status='RETIRED',updated_at=clock_timestamp() WHERE id=(SELECT destination_id FROM wlt.customer_manual_withdrawal_intakes WHERE id=$1) AND status IN ('CANDIDATE','PENDING_APPROVAL','ACTIVE_FOR_PAYOUT')`, intakeID); err != nil {
		return CustomerWithdrawalIntakeRecord{}, err
	}
	requestHash := hashFacts("customer-withdrawal-rejected", intakeID, actorID, reason)
	if _, err := tx.ExecContext(ctx, `UPDATE wlt.customer_manual_withdrawal_intakes SET status='REJECTED',finance_actor_id=$2,resolved_at=clock_timestamp(),resolution_reason=$3 WHERE id=$1`, intakeID, actorID, reason); err != nil {
		return CustomerWithdrawalIntakeRecord{}, err
	}
	if err := insertCustomerWithdrawalEvent(ctx, tx, intakeID, "FINANCE_REJECTED", actorID, reason, "", "", idempotencyKey, requestHash, correlationID); err != nil {
		return CustomerWithdrawalIntakeRecord{}, err
	}
	item, err := readCustomerWithdrawalIntake(ctx, tx, intakeID)
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return CustomerWithdrawalIntakeRecord{}, err
	}
	return item, nil
}

func readCustomerWithdrawalIntake(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, intakeID string) (CustomerWithdrawalIntakeRecord, error) {
	var item CustomerWithdrawalIntakeRecord
	var destinationID, payoutID, financeActorID, resolutionReason sql.NullString
	var resolvedAt sql.NullTime
	err := source.QueryRowContext(ctx, `SELECT id,customer_actor_id,provider_key,wallet_identifier_masked,beneficiary_name,beneficiary_identity_version,request_reason,request_evidence_document_id,status,destination_id,payout_id,requested_by,requested_at,finance_actor_id,resolved_at,resolution_reason FROM wlt.customer_manual_withdrawal_intakes WHERE id=$1`, intakeID).Scan(&item.ID, &item.CustomerActorID, &item.ProviderKey, &item.WalletIdentifierMasked, &item.BeneficiaryName, &item.BeneficiaryIdentityVersion, &item.RequestReason, &item.RequestEvidenceDocumentID, &item.Status, &destinationID, &payoutID, &item.RequestedBy, &item.RequestedAt, &financeActorID, &resolvedAt, &resolutionReason)
	if errors.Is(err, sql.ErrNoRows) {
		return CustomerWithdrawalIntakeRecord{}, ErrCustomerWithdrawalNotFound
	}
	if err != nil {
		return CustomerWithdrawalIntakeRecord{}, err
	}
	if destinationID.Valid {
		item.DestinationID = &destinationID.String
	}
	if payoutID.Valid {
		item.PayoutID = &payoutID.String
	}
	if financeActorID.Valid {
		item.FinanceActorID = &financeActorID.String
	}
	if resolvedAt.Valid {
		item.ResolvedAt = &resolvedAt.Time
	}
	if resolutionReason.Valid {
		item.ResolutionReason = &resolutionReason.String
	}
	return item, nil
}

func insertCustomerWithdrawalEvent(ctx context.Context, tx *sql.Tx, intakeID, eventType, actorID, reason, evidenceID, payoutID, idempotencyKey, requestHash, correlationID string) error {
	id, err := newID("customer_withdrawal_event")
	if err != nil {
		return err
	}
	var evidence any
	if strings.TrimSpace(evidenceID) != "" {
		evidence = strings.TrimSpace(evidenceID)
	}
	var payout any
	if strings.TrimSpace(payoutID) != "" {
		payout = strings.TrimSpace(payoutID)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.customer_manual_withdrawal_events(id,intake_id,event_type,acting_actor_id,reason,evidence_document_id,payout_id,idempotency_key,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, intakeID, eventType, actorID, reason, evidence, payout, idempotencyKey, requestHash, correlationID)
	return err
}
