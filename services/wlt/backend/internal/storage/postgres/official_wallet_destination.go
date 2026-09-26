package postgres

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

var (
	officialWalletPhoneE164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
	ErrDestinationInvalidInput     = errors.New("official wallet destination input is invalid")
	ErrDestinationNotFound         = errors.New("official wallet destination was not found")
	ErrDestinationState            = errors.New("official wallet destination state does not allow this operation")
	ErrDestinationSeparation       = errors.New("official wallet destination transition requires an independent operator")
	ErrDestinationUnverified       = errors.New("official wallet destination is not active for payout")
)

type DestinationCipher struct {
	aead cipher.AEAD
}

func NewDestinationCipher(rawKey string) (*DestinationCipher, error) {
	rawKey = strings.TrimSpace(rawKey)
	if rawKey == "" {
		return nil, errors.New("WLT_DESTINATION_ENCRYPTION_KEY is required")
	}
	var key []byte
	if decoded, err := hex.DecodeString(rawKey); err == nil {
		key = decoded
	} else if decoded, err := base64.StdEncoding.DecodeString(rawKey); err == nil {
		key = decoded
	}
	if len(key) != 32 {
		return nil, errors.New("WLT_DESTINATION_ENCRYPTION_KEY must decode to 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create destination cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create destination AEAD: %w", err)
	}
	return &DestinationCipher{aead: aead}, nil
}

func (c *DestinationCipher) encrypt(value string) (string, error) {
	if c == nil || c.aead == nil || strings.TrimSpace(value) == "" {
		return "", ErrDestinationInvalidInput
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(value), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func (c *DestinationCipher) decrypt(value string) (string, error) {
	if c == nil || c.aead == nil || strings.TrimSpace(value) == "" {
		return "", ErrDestinationInvalidInput
	}
	sealed, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(sealed) < c.aead.NonceSize() {
		return "", ErrDestinationInvalidInput
	}
	nonce, ciphertext := sealed[:c.aead.NonceSize()], sealed[c.aead.NonceSize():]
	plaintext, err := c.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", ErrDestinationInvalidInput
	}
	return string(plaintext), nil
}

func (c *DestinationCipher) EncryptBytes(value []byte) ([]byte, error) {
	if c == nil || c.aead == nil || len(value) == 0 {
		return nil, ErrDestinationInvalidInput
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return c.aead.Seal(nonce, nonce, value, nil), nil
}

func (c *DestinationCipher) DecryptBytes(value []byte) ([]byte, error) {
	if c == nil || c.aead == nil || len(value) <= c.aead.NonceSize() {
		return nil, ErrDestinationInvalidInput
	}
	nonce, ciphertext := value[:c.aead.NonceSize()], value[c.aead.NonceSize():]
	plaintext, err := c.aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, ErrDestinationInvalidInput
	}
	return plaintext, nil
}

type CreateOfficialWalletDestinationInput struct {
	ActorType                     string
	ActorID                       string
	ProviderKey                   string
	WalletIdentifier              string
	BeneficiaryName               string
	BeneficiaryIdentityVersion    int
	ChangeReason                  string
	VerificationEvidenceReference string
	ChangeEvidenceReference       string
	SubmittedBy                   string
	IdempotencyKey                string
	CorrelationID                 string
}

type OfficialWalletDestinationRecord struct {
	ID                            string
	ActorType                     string
	ActorID                       string
	ProviderKey                   string
	WalletIdentifierMasked        string
	BeneficiaryName               string
	BeneficiaryIdentityVersion    int
	VerificationStatus            string
	Status                        string
	Version                       int
	ChangeReason                  string
	SubmittedBy                   string
	SubmittedAt                   time.Time
	VerifiedBy                    *string
	VerifiedAt                    *time.Time
	ApprovedBy                    *string
	ApprovedAt                    *time.Time
	VerificationEvidenceReference string
	ChangeEvidenceReference       string
	CreatedAt                     time.Time
	UpdatedAt                     time.Time
}

func HashCreateOfficialWalletDestination(input CreateOfficialWalletDestinationInput) string {
	return hashFacts("official-wallet-destination", strings.TrimSpace(input.ActorType), strings.TrimSpace(input.ActorID), strings.TrimSpace(input.ProviderKey), strings.TrimSpace(input.WalletIdentifier), strings.TrimSpace(input.BeneficiaryName), formatInt(input.BeneficiaryIdentityVersion), strings.TrimSpace(input.ChangeReason), strings.TrimSpace(input.VerificationEvidenceReference), strings.TrimSpace(input.ChangeEvidenceReference), strings.TrimSpace(input.SubmittedBy))
}

func CreateOfficialWalletDestination(ctx context.Context, db *sql.DB, cipher *DestinationCipher, input CreateOfficialWalletDestinationInput) (OfficialWalletDestinationRecord, bool, error) {
	input.ActorType = strings.ToLower(strings.TrimSpace(input.ActorType))
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.ProviderKey = strings.TrimSpace(input.ProviderKey)
	input.WalletIdentifier = strings.TrimSpace(input.WalletIdentifier)
	input.BeneficiaryName = strings.TrimSpace(input.BeneficiaryName)
	input.ChangeReason = strings.TrimSpace(input.ChangeReason)
	input.VerificationEvidenceReference = strings.TrimSpace(input.VerificationEvidenceReference)
	input.ChangeEvidenceReference = strings.TrimSpace(input.ChangeEvidenceReference)
	input.SubmittedBy = strings.TrimSpace(input.SubmittedBy)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	if db == nil || cipher == nil || !validDestinationActor(input.ActorType) || boundedText(input.ActorID, 1, 128) == "" || boundedText(input.ProviderKey, 1, 64) == "" || !officialWalletPhoneE164Pattern.MatchString(input.WalletIdentifier) || boundedText(input.BeneficiaryName, 1, 320) == "" || input.BeneficiaryIdentityVersion < 1 || boundedText(input.ChangeReason, 1, 512) == "" || boundedText(input.VerificationEvidenceReference, 1, 512) == "" || boundedText(input.ChangeEvidenceReference, 1, 512) == "" || boundedText(input.SubmittedBy, 1, 128) == "" || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 {
		return OfficialWalletDestinationRecord{}, false, ErrDestinationInvalidInput
	}
	ciphertext, err := cipher.encrypt(input.WalletIdentifier)
	if err != nil {
		return OfficialWalletDestinationRecord{}, false, err
	}
	requestHash := HashCreateOfficialWalletDestination(input)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OfficialWalletDestinationRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:destination:"+input.ActorType+":"+input.ActorID); err != nil {
		return OfficialWalletDestinationRecord{}, false, err
	}
	var existingID, existingHash string
	err = tx.QueryRowContext(ctx, "SELECT id,request_hash FROM wlt.official_wallet_destinations WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&existingID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return OfficialWalletDestinationRecord{}, false, ErrIdempotencyConflict
		}
		item, readErr := readOfficialWalletDestination(ctx, tx, existingID)
		if readErr != nil {
			return OfficialWalletDestinationRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return OfficialWalletDestinationRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OfficialWalletDestinationRecord{}, false, err
	}
	var version int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0)+1 FROM wlt.official_wallet_destinations WHERE actor_type=$1 AND actor_id=$2", input.ActorType, input.ActorID).Scan(&version); err != nil {
		return OfficialWalletDestinationRecord{}, false, err
	}
	id, err := newID("destination")
	if err != nil {
		return OfficialWalletDestinationRecord{}, false, err
	}
	masked := maskWalletIdentifier(input.WalletIdentifier)
	_, err = tx.ExecContext(ctx, `INSERT INTO wlt.official_wallet_destinations(id,actor_type,actor_id,provider_key,wallet_identifier_ciphertext,wallet_identifier_masked,beneficiary_name,beneficiary_identity_version,version,change_reason,submitted_by,verification_evidence_reference,change_evidence_reference,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, id, input.ActorType, input.ActorID, input.ProviderKey, ciphertext, masked, input.BeneficiaryName, input.BeneficiaryIdentityVersion, version, input.ChangeReason, input.SubmittedBy, input.VerificationEvidenceReference, input.ChangeEvidenceReference, input.IdempotencyKey, requestHash)
	if err != nil {
		return OfficialWalletDestinationRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OfficialWalletDestinationRecord{}, false, err
	}
	item, err := ReadOfficialWalletDestination(ctx, db, input.ActorType, input.ActorID)
	return item, false, err
}

func VerifyOfficialWalletDestination(ctx context.Context, db *sql.DB, destinationID, actorID, evidenceReference, idempotencyKey, correlationID string) (OfficialWalletDestinationRecord, error) {
	return transitionOfficialWalletDestination(ctx, db, destinationID, actorID, "VERIFY", strings.TrimSpace(evidenceReference), strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID))
}

func ActivateOfficialWalletDestination(ctx context.Context, db *sql.DB, destinationID, actorID, idempotencyKey, correlationID string) (OfficialWalletDestinationRecord, error) {
	return transitionOfficialWalletDestination(ctx, db, destinationID, actorID, "ACTIVATE", "", strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID))
}

func transitionOfficialWalletDestination(ctx context.Context, db *sql.DB, destinationID, actorID, operation, evidenceReference, idempotencyKey, correlationID string) (OfficialWalletDestinationRecord, error) {
	destinationID, actorID, idempotencyKey, correlationID = strings.TrimSpace(destinationID), strings.TrimSpace(actorID), strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || boundedText(destinationID, 1, 128) == "" || boundedText(actorID, 1, 128) == "" || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 {
		return OfficialWalletDestinationRecord{}, ErrDestinationInvalidInput
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	requestHash := hashFacts("official-wallet-destination-transition", destinationID, actorID, operation, evidenceReference)
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "wlt:destination-transition:"+idempotencyKey); err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	var existingHash, existingDestinationID string
	err = tx.QueryRowContext(ctx, "SELECT destination_id,request_hash FROM wlt.official_wallet_destination_transitions WHERE idempotency_key=$1", idempotencyKey).Scan(&existingDestinationID, &existingHash)
	if err == nil {
		if existingHash != requestHash {
			return OfficialWalletDestinationRecord{}, ErrIdempotencyConflict
		}
		item, readErr := readOfficialWalletDestination(ctx, tx, existingDestinationID)
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
	var actorType, status, verificationStatus, currentEvidence, submittedBy string
	var verifiedBy sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT actor_type,status,verification_status,change_evidence_reference,submitted_by,verified_by FROM wlt.official_wallet_destinations WHERE id=$1 FOR UPDATE", destinationID).Scan(&actorType, &status, &verificationStatus, &currentEvidence, &submittedBy, &verifiedBy); errors.Is(err, sql.ErrNoRows) {
		return OfficialWalletDestinationRecord{}, ErrDestinationNotFound
	} else if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	if operation == "VERIFY" {
		if status != "CANDIDATE" || verificationStatus != "PENDING_VERIFICATION" || boundedText(evidenceReference, 1, 512) == "" {
			return OfficialWalletDestinationRecord{}, ErrDestinationState
		}
		if submittedBy == actorID {
			return OfficialWalletDestinationRecord{}, ErrDestinationSeparation
		}
		if _, err := tx.ExecContext(ctx, "UPDATE wlt.official_wallet_destinations SET verification_status='VERIFIED',status='PENDING_APPROVAL',verified_by=$2,verified_at=clock_timestamp(),verification_evidence_reference=$3,updated_at=clock_timestamp() WHERE id=$1", destinationID, actorID, evidenceReference); err != nil {
			return OfficialWalletDestinationRecord{}, err
		}
	} else if operation == "ACTIVATE" {
		if status != "PENDING_APPROVAL" || verificationStatus != "VERIFIED" || currentEvidence == "" {
			return OfficialWalletDestinationRecord{}, ErrDestinationState
		}
		if verifiedBy.Valid && verifiedBy.String == actorID {
			return OfficialWalletDestinationRecord{}, ErrDestinationSeparation
		}
		if _, err := tx.ExecContext(ctx, "UPDATE wlt.official_wallet_destinations SET status='RETIRED',updated_at=clock_timestamp() WHERE actor_type=$1 AND actor_id=(SELECT actor_id FROM wlt.official_wallet_destinations WHERE id=$2) AND status='ACTIVE_FOR_PAYOUT' AND id<>$2", actorType, destinationID); err != nil {
			return OfficialWalletDestinationRecord{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE wlt.official_wallet_destinations SET status='ACTIVE_FOR_PAYOUT',approved_by=$2,approved_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", destinationID, actorID); err != nil {
			return OfficialWalletDestinationRecord{}, err
		}
	} else {
		return OfficialWalletDestinationRecord{}, ErrDestinationInvalidInput
	}
	transitionID, err := newID("destination_transition")
	if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO wlt.official_wallet_destination_transitions(id,destination_id,operation,idempotency_key,request_hash,actor_id,correlation_id,evidence_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, transitionID, destinationID, operation, idempotencyKey, requestHash, actorID, correlationID, evidenceReference); err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	if actorType == "customer" {
		var intakeID, requestEvidenceID string
		intakeErr := tx.QueryRowContext(ctx, "SELECT id,request_evidence_document_id FROM wlt.customer_manual_withdrawal_intakes WHERE destination_id=$1 FOR UPDATE", destinationID).Scan(&intakeID, &requestEvidenceID)
		if intakeErr == nil {
			eventType := "DESTINATION_VERIFIED"
			if operation == "ACTIVATE" {
				eventType = "DESTINATION_ACTIVATED"
			}
			if err := insertCustomerWithdrawalEvent(ctx, tx, intakeID, eventType, actorID, "customer withdrawal destination "+strings.ToLower(operation), requestEvidenceID, "", "customer-withdrawal-"+strings.ToLower(operation)+":"+destinationID, requestHash, correlationID); err != nil {
				return OfficialWalletDestinationRecord{}, err
			}
		} else if !errors.Is(intakeErr, sql.ErrNoRows) {
			return OfficialWalletDestinationRecord{}, intakeErr
		}
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

func ReadOfficialWalletDestination(ctx context.Context, db *sql.DB, actorType, actorID string) (OfficialWalletDestinationRecord, error) {
	actorType, actorID = strings.ToLower(strings.TrimSpace(actorType)), strings.TrimSpace(actorID)
	if db == nil || !validDestinationActor(actorType) || boundedText(actorID, 1, 128) == "" {
		return OfficialWalletDestinationRecord{}, ErrDestinationInvalidInput
	}
	return readOfficialWalletDestinationQuery(ctx, db, "SELECT id,actor_type,actor_id,provider_key,wallet_identifier_masked,beneficiary_name,beneficiary_identity_version,verification_status,status,version,change_reason,submitted_by,submitted_at,verified_by,verified_at,approved_by,approved_at,verification_evidence_reference,change_evidence_reference,created_at,updated_at FROM wlt.official_wallet_destinations WHERE actor_type=$1 AND actor_id=$2 ORDER BY version DESC LIMIT 1", actorType, actorID)
}

func ReadOfficialWalletDestinationByID(ctx context.Context, db *sql.DB, destinationID string) (OfficialWalletDestinationRecord, error) {
	destinationID = strings.TrimSpace(destinationID)
	if db == nil || boundedText(destinationID, 1, 128) == "" {
		return OfficialWalletDestinationRecord{}, ErrDestinationInvalidInput
	}
	return readOfficialWalletDestination(ctx, db, destinationID)
}

func readOfficialWalletDestination(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, destinationID string) (OfficialWalletDestinationRecord, error) {
	return readOfficialWalletDestinationQuery(ctx, source, "SELECT id,actor_type,actor_id,provider_key,wallet_identifier_masked,beneficiary_name,beneficiary_identity_version,verification_status,status,version,change_reason,submitted_by,submitted_at,verified_by,verified_at,approved_by,approved_at,verification_evidence_reference,change_evidence_reference,created_at,updated_at FROM wlt.official_wallet_destinations WHERE id=$1", destinationID)
}

func readOfficialWalletDestinationQuery(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, query string, args ...any) (OfficialWalletDestinationRecord, error) {
	var item OfficialWalletDestinationRecord
	var verifiedBy, approvedBy sql.NullString
	var beneficiaryIdentityVersion sql.NullInt64
	var verifiedAt, approvedAt *time.Time
	err := source.QueryRowContext(ctx, query, args...).Scan(&item.ID, &item.ActorType, &item.ActorID, &item.ProviderKey, &item.WalletIdentifierMasked, &item.BeneficiaryName, &beneficiaryIdentityVersion, &item.VerificationStatus, &item.Status, &item.Version, &item.ChangeReason, &item.SubmittedBy, &item.SubmittedAt, &verifiedBy, &verifiedAt, &approvedBy, &approvedAt, &item.VerificationEvidenceReference, &item.ChangeEvidenceReference, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return OfficialWalletDestinationRecord{}, ErrDestinationNotFound
	}
	if err != nil {
		return OfficialWalletDestinationRecord{}, err
	}
	if verifiedBy.Valid {
		item.VerifiedBy = &verifiedBy.String
	}
	if beneficiaryIdentityVersion.Valid {
		item.BeneficiaryIdentityVersion = int(beneficiaryIdentityVersion.Int64)
	}
	if approvedBy.Valid {
		item.ApprovedBy = &approvedBy.String
	}
	item.VerifiedAt, item.ApprovedAt = verifiedAt, approvedAt
	return item, nil
}

func validDestinationActor(actorType string) bool {
	return actorType == "customer" || actorType == "partner" || actorType == "captain" || actorType == "field"
}

func boundedText(value string, min, max int) string {
	value = strings.TrimSpace(value)
	if len(value) < min || len(value) > max {
		return ""
	}
	return value
}

func maskWalletIdentifier(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 4 {
		return value
	}
	return "••••" + value[len(value)-4:]
}
