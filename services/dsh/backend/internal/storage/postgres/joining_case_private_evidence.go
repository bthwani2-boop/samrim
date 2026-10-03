package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrJoiningCaseEvidenceUnavailable = errors.New("joining-case private evidence is unavailable")
	ErrJoiningCaseProofImageRequired  = errors.New("a fresh proof image is required for joining-case correction")
)

type JoiningCaseProofImageInput struct {
	CaseID, ActorID, AuthoritySource, CorrelationID, IdempotencyKey, RequestHash string
	ExpectedVersion                                                              int
	KeyID                                                                        string
	Ciphertext                                                                   []byte
	CiphertextSHA256                                                             string
	ContentType                                                                  string
	ByteSize                                                                     int64
}

type JoiningCaseProofDetails struct {
	CaseID, ProofType, ProofNumber string
	ImageUploaded                  bool
	ImageContentType               string
	ImageByteSize                  int64
}

type JoiningCaseProofImage struct {
	ContentType string
	Data        []byte
}

func UploadJoiningCaseProofImage(ctx context.Context, db *sql.DB, input JoiningCaseProofImageInput) (JoiningCaseResult, error) {
	input.CaseID = strings.TrimSpace(input.CaseID)
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.AuthoritySource = strings.TrimSpace(input.AuthoritySource)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if db == nil || input.CaseID == "" || input.ActorID == "" || (input.AuthoritySource != "field" && input.AuthoritySource != "partner" && input.AuthoritySource != "operator") || len(input.CorrelationID) < 8 || len(input.CorrelationID) > 128 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || input.ExpectedVersion < 1 || input.KeyID == "" || len(input.Ciphertext) < 29 || len(input.CiphertextSHA256) != 64 || (input.ContentType != "image/jpeg" && input.ContentType != "image/png") || input.ByteSize < 1 || input.ByteSize > 10*1024*1024 || len(input.RequestHash) < 1 || len(input.RequestHash) > 128 {
		return JoiningCaseResult{}, ErrJoiningCaseEvidenceUnavailable
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("begin private proof image upload: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockJoiningCaseKey(ctx, tx, input.IdempotencyKey); err != nil {
		return JoiningCaseResult{}, err
	}
	var storedCaseID, storedHash string
	err = tx.QueryRowContext(ctx, `SELECT joining_case_id,request_hash FROM dsh.joining_case_private_evidence_audit WHERE idempotency_key=$1 AND event_type='proof_image_uploaded' FOR UPDATE`, input.IdempotencyKey).Scan(&storedCaseID, &storedHash)
	if err == nil {
		if storedCaseID != input.CaseID || storedHash != input.RequestHash {
			return JoiningCaseResult{}, ErrJoiningCaseIdempotency
		}
		result, readErr := readJoiningCaseTx(ctx, tx, input.CaseID)
		if readErr != nil {
			return JoiningCaseResult{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return JoiningCaseResult{}, err
		}
		result.Replayed = true
		return result, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseResult{}, fmt.Errorf("read private proof image idempotency: %w", err)
	}
	current, err := readJoiningCaseTx(ctx, tx, input.CaseID)
	if err != nil {
		return JoiningCaseResult{}, err
	}
	if current.Case.Version != input.ExpectedVersion {
		return JoiningCaseResult{}, ErrJoiningCaseVersion
	}
	switch input.AuthoritySource {
	case "field":
		if current.Case.Origin != "field" || current.Case.OriginatingFieldActorID != input.ActorID || current.Case.State != "draft" {
			return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
		}
	case "partner":
		if current.Case.PartnerActorID != input.ActorID || current.Case.State != "needs_correction" {
			return JoiningCaseResult{}, ErrJoiningCasePartnerAccess
		}
	case "operator":
		if current.Case.State != "draft" {
			return JoiningCaseResult{}, ErrJoiningCaseState
		}
	}
	resultVersion := input.ExpectedVersion + 1
	updatedEvidence, err := tx.ExecContext(ctx, `UPDATE dsh.joining_case_private_evidence SET proof_image_key_id=$2,proof_image_ciphertext=$3,proof_image_content_type=$4,proof_image_ciphertext_sha256=$5,proof_image_byte_size=$6,proof_image_uploaded_at=clock_timestamp(),updated_at=clock_timestamp() WHERE joining_case_id=$1`, input.CaseID, input.KeyID, input.Ciphertext, input.ContentType, input.CiphertextSHA256, input.ByteSize)
	if err != nil {
		return JoiningCaseResult{}, fmt.Errorf("store encrypted joining-case proof image: %w", err)
	}
	if count, countErr := updatedEvidence.RowsAffected(); countErr != nil || count != 1 {
		return JoiningCaseResult{}, ErrJoiningCaseEvidenceUnavailable
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.joining_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2`, input.CaseID, input.ExpectedVersion); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("advance joining-case version after proof image upload: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_private_evidence_audit(joining_case_id,event_type,idempotency_key,correlation_id,acting_actor_id,authority_source,expected_version,result_version,request_hash) VALUES($1,'proof_image_uploaded',$2,$3,$4,$5,$6,$7,$8)`, input.CaseID, input.IdempotencyKey, input.CorrelationID, input.ActorID, input.AuthoritySource, input.ExpectedVersion, resultVersion, input.RequestHash); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("audit joining-case proof image upload: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseResult{}, fmt.Errorf("commit joining-case proof image upload: %w", err)
	}
	result, err := ReadJoiningCase(ctx, db, input.CaseID)
	result.Replayed = false
	return result, err
}

func CiphertextSHA256(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func ReadJoiningCaseProofDetailsForOperator(ctx context.Context, db *sql.DB, caseID, actorID, correlationID string, keys *JoiningCaseEvidenceKeyring) (JoiningCaseProofDetails, error) {
	caseID, actorID, correlationID = strings.TrimSpace(caseID), strings.TrimSpace(actorID), strings.TrimSpace(correlationID)
	if db == nil || caseID == "" || actorID == "" || len(correlationID) < 8 || len(correlationID) > 128 || keys == nil {
		return JoiningCaseProofDetails{}, ErrJoiningCaseEvidenceUnavailable
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseProofDetails{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var proofType, keyID string
	var ciphertext []byte
	var imageUploaded bool
	var imageType sql.NullString
	var imageSize sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT c.first_store_proof_type,e.proof_number_key_id,e.proof_number_ciphertext,e.proof_image_ciphertext IS NOT NULL,e.proof_image_content_type,e.proof_image_byte_size FROM dsh.joining_cases c JOIN dsh.joining_case_private_evidence e ON e.joining_case_id=c.id WHERE c.id=$1`, caseID).Scan(&proofType, &keyID, &ciphertext, &imageUploaded, &imageType, &imageSize)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseProofDetails{}, ErrJoiningCaseEvidenceUnavailable
	}
	if err != nil {
		return JoiningCaseProofDetails{}, fmt.Errorf("read encrypted joining-case proof details: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_private_evidence_audit(joining_case_id,event_type,correlation_id,acting_actor_id,authority_source) VALUES($1,'proof_details_read',$2,$3,'operator')`, caseID, correlationID, actorID); err != nil {
		return JoiningCaseProofDetails{}, fmt.Errorf("audit joining-case proof detail read: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseProofDetails{}, err
	}
	plaintext, err := keys.Decrypt(caseID, "proof-number", keyID, ciphertext)
	if err != nil {
		return JoiningCaseProofDetails{}, err
	}
	result := JoiningCaseProofDetails{CaseID: caseID, ProofType: proofType, ProofNumber: string(plaintext), ImageUploaded: imageUploaded}
	if imageType.Valid {
		result.ImageContentType = imageType.String
	}
	if imageSize.Valid {
		result.ImageByteSize = imageSize.Int64
	}
	return result, nil
}

func ReadJoiningCaseProofImageForOperator(ctx context.Context, db *sql.DB, caseID, actorID, correlationID string, keys *JoiningCaseEvidenceKeyring) (JoiningCaseProofImage, error) {
	caseID, actorID, correlationID = strings.TrimSpace(caseID), strings.TrimSpace(actorID), strings.TrimSpace(correlationID)
	if db == nil || caseID == "" || actorID == "" || len(correlationID) < 8 || len(correlationID) > 128 || keys == nil {
		return JoiningCaseProofImage{}, ErrJoiningCaseEvidenceUnavailable
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return JoiningCaseProofImage{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var keyID, contentType, ciphertextSHA256 string
	var ciphertext []byte
	err = tx.QueryRowContext(ctx, `SELECT proof_image_key_id,proof_image_ciphertext,proof_image_content_type,proof_image_ciphertext_sha256 FROM dsh.joining_case_private_evidence WHERE joining_case_id=$1 AND proof_image_ciphertext IS NOT NULL`, caseID).Scan(&keyID, &ciphertext, &contentType, &ciphertextSHA256)
	if errors.Is(err, sql.ErrNoRows) {
		return JoiningCaseProofImage{}, ErrJoiningCaseEvidenceUnavailable
	}
	if err != nil {
		return JoiningCaseProofImage{}, fmt.Errorf("read encrypted joining-case proof image: %w", err)
	}
	if CiphertextSHA256(ciphertext) != ciphertextSHA256 {
		return JoiningCaseProofImage{}, ErrJoiningCaseEvidenceUnavailable
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.joining_case_private_evidence_audit(joining_case_id,event_type,correlation_id,acting_actor_id,authority_source) VALUES($1,'proof_image_downloaded',$2,$3,'operator')`, caseID, correlationID, actorID); err != nil {
		return JoiningCaseProofImage{}, fmt.Errorf("audit joining-case proof image download: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return JoiningCaseProofImage{}, err
	}
	plaintext, err := keys.Decrypt(caseID, "proof-image", keyID, ciphertext)
	if err != nil {
		return JoiningCaseProofImage{}, err
	}
	return JoiningCaseProofImage{ContentType: contentType, Data: plaintext}, nil
}
