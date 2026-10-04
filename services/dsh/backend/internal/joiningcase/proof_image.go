package joiningcase

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func UploadPrivateProofImage(ctx context.Context, db *sql.DB, evidenceKeys *postgres.JoiningCaseEvidenceKeyring, caseID, actorID, authoritySource, hashScope, idempotencyKey, correlationID string, expectedVersion int, declaredContentType string, data []byte) (postgres.JoiningCaseResult, error) {
	caseID = strings.TrimSpace(caseID)
	contentType, _, _, validationErr := media.ValidateImageBytes(data)
	if caseID == "" || expectedVersion < 1 || validationErr != nil || contentType != strings.TrimSpace(declaredContentType) {
		return postgres.JoiningCaseResult{}, ErrInvalidInput
	}
	keyID, ciphertext, err := evidenceKeys.Encrypt(caseID, "proof-image", data)
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	digest := sha256.Sum256(data)
	requestHash, err := evidenceKeys.RequestHash(hashScope, caseID, actorID, hex.EncodeToString(digest[:]), strconv.Itoa(expectedVersion))
	if err != nil {
		return postgres.JoiningCaseResult{}, err
	}
	return postgres.UploadJoiningCaseProofImage(ctx, db, postgres.JoiningCaseProofImageInput{CaseID: caseID, ActorID: actorID, AuthoritySource: authoritySource, CorrelationID: strings.TrimSpace(correlationID), IdempotencyKey: strings.TrimSpace(idempotencyKey), RequestHash: requestHash, ExpectedVersion: expectedVersion, KeyID: keyID, Ciphertext: ciphertext, CiphertextSHA256: postgres.CiphertextSHA256(ciphertext), ContentType: contentType, ByteSize: int64(len(data))})
}
